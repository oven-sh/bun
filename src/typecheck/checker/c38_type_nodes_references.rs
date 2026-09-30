// checker.go:22913-23876 (layers T-TYPENODE, T-TUPLE, T-DECLARED): types of type nodes and type references, tuple normalization, array and tuple predicates, declared types of symbols.
use crate::ast::{
    Arg, Ast, CheckFlags, INTERNAL_SYMBOL_NAME_PREFIX, Kind, NodeFlags, NodeId, SymbolFlags,
    SymbolId, get_containing_function, get_symbol_id, get_this_container, is_assertion_expression,
    is_class_like, is_constructor_declaration, is_entity_name_expression,
    is_expression_with_type_arguments, is_function_expression_or_arrow_function, is_identifier,
    is_in_js_file, is_interface_declaration, is_jsdoc_augments_tag, is_parenthesized_type_node,
    is_part_of_type_node, is_static, is_type_operator_node, is_type_reference_node,
    is_type_reference_type, is_variable_declaration, walk_up_parenthesized_types,
};
use crate::checker::{
    AccessFlags, Checker, ElementFlags, IntrinsicTypeKind, ObjectFlags, TupleElementInfo,
    TupleType, TypeAlias, TypeAliasId, TypeFlags, TypeFormatFlags, TypeId, TypeMapperId,
    every_type, get_alias_key, get_type_alias_instantiation_key, intrinsic_type_kinds,
    is_const_type_reference, is_node_descendant_of, is_type_alias, is_valid_es_symbol_declaration,
    new_type_mapper,
};
use crate::core::{List, Tristate};
use crate::diagnostics;
use crate::jsnum::Number;
use crate::scanner::declaration_name_to_string;

// `s[i]` as a guarded read: the zero value when the index is outside the slice.
fn at<T: Copy + Default>(items: &[T], index: usize) -> T {
    items.get(index).copied().unwrap_or_default()
}

impl<'a> Checker<'a> {
    pub fn try_get_type_from_type_node(&mut self, node: NodeId) -> TypeId {
        let type_node = self.ast.type_node(node);
        if !type_node.is_nil() {
            return self.get_type_from_type_node(type_node);
        }
        TypeId::NIL
    }

    pub fn get_type_from_type_node(&mut self, node: NodeId) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let t = self.get_type_from_type_node_worker(node);
        self.get_conditional_flow_type_of_type(t, node)
    }

    pub fn get_type_from_type_node_worker(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        match a.kind(node) {
            Kind::AnyKeyword | Kind::JSDocAllType => self.any_type,
            Kind::JSDocNonNullableType => self.get_type_from_type_node(a.type_node(node)),
            Kind::JSDocNullableType => {
                let t = self.get_type_from_type_node(a.type_node(node));
                if self.strict_null_checks {
                    self.get_nullable_type(t, TypeFlags::NULL)
                } else {
                    t
                }
            }
            Kind::JSDocVariadicType => {
                let element_type =
                    self.get_type_from_type_node(a.as_jsdoc_variadic_type(node).type_node);
                self.create_array_type(element_type)
            }
            Kind::JSDocOptionalType => {
                let t = self.get_type_from_type_node(a.type_node(node));
                self.add_optionality(t)
            }
            Kind::UnknownKeyword => self.unknown_type,
            Kind::StringKeyword => self.string_type,
            Kind::NumberKeyword => self.number_type,
            Kind::BigIntKeyword => self.bigint_type,
            Kind::BooleanKeyword => self.boolean_type,
            Kind::SymbolKeyword => self.es_symbol_type,
            Kind::VoidKeyword => self.void_type,
            Kind::UndefinedKeyword => self.undefined_type,
            Kind::NullKeyword => self.null_type,
            Kind::NeverKeyword => self.never_type,
            Kind::ObjectKeyword => self.non_primitive_type,
            Kind::IntrinsicKeyword => self.intrinsic_marker_type,
            Kind::ThisType | Kind::ThisKeyword => self.get_type_from_this_type_node(node),
            Kind::LiteralType => self.get_type_from_literal_type_node(node),
            Kind::TypeReference | Kind::ExpressionWithTypeArguments => {
                self.get_type_from_type_reference(node)
            }
            Kind::TypePredicate => {
                if !a.as_type_predicate_node(node).asserts_modifier.is_nil() {
                    self.void_type
                } else {
                    self.boolean_type
                }
            }
            Kind::TypeQuery => self.get_type_from_type_query_node(node),
            Kind::ArrayType | Kind::TupleType => self.get_type_from_array_or_tuple_type_node(node),
            Kind::OptionalType => self.get_type_from_optional_type_node(node),
            Kind::UnionType => self.get_type_from_union_type_node(node),
            Kind::IntersectionType => self.get_type_from_intersection_type_node(node),
            Kind::NamedTupleMember => self.get_type_from_named_tuple_type_node(node),
            Kind::ParenthesizedType => self.get_type_from_type_node(a.type_node(node)),
            Kind::RestType => self.get_type_from_rest_type_node(node),
            Kind::FunctionType | Kind::ConstructorType | Kind::TypeLiteral => {
                self.get_type_from_type_literal_or_function_or_constructor_type_node(node)
            }
            Kind::TypeOperator => self.get_type_from_type_operator_node(node),
            Kind::IndexedAccessType => self.get_type_from_indexed_access_type_node(node),
            Kind::TemplateLiteralType => self.get_type_from_template_type_node(node),
            Kind::MappedType => self.get_type_from_mapped_type_node(node),
            Kind::ConditionalType => self.get_type_from_conditional_type_node(node),
            Kind::InferType => self.get_type_from_infer_type_node(node),
            Kind::ImportType => self.get_type_from_import_type_node(node),
            _ => self.error_type,
        }
    }

    pub fn get_type_from_this_type_node(&mut self, node: NodeId) -> TypeId {
        let links = self.type_node_links.get(node);
        if self.type_node_links[links].resolved_type.is_nil() {
            let t = self.get_this_type(node);
            self.type_node_links[links].resolved_type = t;
        }
        self.type_node_links[links].resolved_type
    }

    pub fn get_this_type(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        let container = get_this_container(a, node, false, false);
        if !container.is_nil() {
            let parent = a.parent(container);
            if !parent.is_nil() && (is_class_like(a, parent) || is_interface_declaration(a, parent))
            {
                if !is_static(a, container)
                    && (!is_constructor_declaration(a, container)
                        || is_node_descendant_of(a, node, a.body(container)))
                {
                    let symbol = self.get_symbol_of_declaration(parent);
                    let declared_type = self.get_declared_type_of_class_or_interface(symbol);
                    let this_type = self.as_interface_type(declared_type).this_type;
                    if !this_type.is_nil() {
                        return this_type;
                    }
                    return self.error_type;
                }
            }
        }
        self.error(
            node,
            diagnostics::A_THIS_TYPE_IS_AVAILABLE_ONLY_IN_A_NON_STATIC_MEMBER_OF_A_CLASS_OR_INTERFACE,
            &[],
        );
        self.error_type
    }

    pub fn get_type_from_literal_type_node(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        let literal = a.as_literal_type_node(node).literal;
        if a.kind(literal) == Kind::NullKeyword {
            return self.null_type;
        }
        let links = self.type_node_links.get(node);
        if self.type_node_links[links].resolved_type.is_nil() {
            let literal_type = self.check_expression(literal);
            let t = self.get_regular_type_of_literal_type(literal_type);
            self.type_node_links[links].resolved_type = t;
        }
        self.type_node_links[links].resolved_type
    }

    pub fn get_type_from_type_literal_or_function_or_constructor_type_node(
        &mut self,
        node: NodeId,
    ) -> TypeId {
        let a = self.ast;
        let links = self.type_node_links.get(node);
        if self.type_node_links[links].resolved_type.is_nil() {
            // Deferred resolution of members is handled by resolveObjectTypeMembers
            let alias = self.get_alias_for_type_node(node);
            let symbol = a.symbol(node);
            let mut is_empty = symbol.is_nil();
            if !is_empty {
                let members = self.get_members_of_symbol(symbol);
                is_empty = a.table_len(members) == 0 && alias.is_nil();
            }
            if is_empty {
                self.type_node_links[links].resolved_type = self.empty_type_literal_type;
            } else {
                let t = self.new_object_type(ObjectFlags::ANONYMOUS, symbol);
                self.types[t].alias = alias;
                self.type_node_links[links].resolved_type = t;
            }
        }
        self.type_node_links[links].resolved_type
    }

    pub fn get_type_from_indexed_access_type_node(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        let links = self.type_node_links.get(node);
        if self.type_node_links[links].resolved_type.is_nil() {
            let data = a.as_indexed_access_type_node(node);
            let object_type = self.get_type_from_type_node(data.object_type);
            let index_type = self.get_type_from_type_node(data.index_type);
            let potential_alias = self.get_alias_for_type_node(node);
            let t = self.get_indexed_access_type_ex(
                object_type,
                index_type,
                AccessFlags::NONE,
                node,
                potential_alias,
            );
            self.type_node_links[links].resolved_type = t;
        }
        self.type_node_links[links].resolved_type
    }

    pub fn get_type_from_type_operator_node(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        let links = self.type_node_links.get(node);
        if self.type_node_links[links].resolved_type.is_nil() {
            let arg_type = a.type_node(node);
            let t = match a.as_type_operator_node(node).operator {
                Kind::KeyOfKeyword => {
                    let operand_type = self.get_type_from_type_node(arg_type);
                    self.get_index_type(operand_type)
                }
                Kind::UniqueKeyword => {
                    if a.kind(arg_type) == Kind::SymbolKeyword {
                        let declaration = walk_up_parenthesized_types(a, a.parent(node));
                        self.get_es_symbol_like_type_for_node(declaration)
                    } else {
                        self.error_type
                    }
                }
                Kind::ReadonlyKeyword => self.get_type_from_type_node(arg_type),
                _ => self.fail("Unhandled case in getTypeFromTypeOperatorNode"),
            };
            self.type_node_links[links].resolved_type = t;
        }
        self.type_node_links[links].resolved_type
    }

    pub fn get_es_symbol_like_type_for_node(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        if is_valid_es_symbol_declaration(a, node) {
            let symbol = self.get_symbol_of_node(node);
            if !symbol.is_nil() {
                let mut unique_type = self.unique_es_symbol_types.get(&symbol);
                if unique_type.is_nil() {
                    let mut b: Vec<u8> = Vec::new();
                    b.extend_from_slice(INTERNAL_SYMBOL_NAME_PREFIX);
                    b.push(b'@');
                    b.extend_from_slice(a.sym(symbol).name);
                    b.push(b'@');
                    b.extend_from_slice(get_symbol_id(a, symbol).to_string().as_bytes());
                    let name = self.text(&b);
                    unique_type = self.new_unique_es_symbol_type(symbol, name);
                    let ok = self.unique_es_symbol_types.set(symbol, unique_type);
                    self.map_set(ok);
                }
                return unique_type;
            }
        }
        self.es_symbol_type
    }

    pub fn get_type_from_type_reference(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        let links = self.type_node_links.get(node);
        if self.type_node_links[links].resolved_type.is_nil() {
            // Cache both the resolved symbol and the resolved type. The resolved symbol is needed when we check the type reference in checkTypeReferenceNode. Handle LS queries on the `const` in `x as const` by resolving to the type of `x`.
            let t =
                if is_const_type_reference(a, node) && is_assertion_expression(a, a.parent(node)) {
                    self.check_expression_cached(a.expression(a.parent(node)))
                } else {
                    let intended = self.get_intended_type_from_jsdoc_type_reference(node);
                    if !intended.is_nil() {
                        intended
                    } else {
                        let symbol = self.get_symbol_from_type_reference(node);
                        self.get_type_reference_type(node, symbol)
                    }
                };
            self.type_node_links[links].resolved_type = t;
        }
        self.type_node_links[links].resolved_type
    }

    pub fn get_intended_type_from_jsdoc_type_reference(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        if a.flags(node).intersects(NodeFlags::JSDOC) && is_type_reference_node(a, node) {
            let type_name = a.as_type_reference_node(node).type_name;
            if is_identifier(a, type_name) {
                let type_args = a.type_arguments(node).as_slice();
                match a.text(type_name) {
                    b"String" => {
                        self.check_no_type_arguments(node, SymbolId::NIL);
                        return self.string_type;
                    }
                    b"Number" => {
                        self.check_no_type_arguments(node, SymbolId::NIL);
                        return self.number_type;
                    }
                    b"BigInt" => {
                        self.check_no_type_arguments(node, SymbolId::NIL);
                        return self.bigint_type;
                    }
                    b"Boolean" => {
                        self.check_no_type_arguments(node, SymbolId::NIL);
                        return self.boolean_type;
                    }
                    b"Void" => {
                        self.check_no_type_arguments(node, SymbolId::NIL);
                        return self.void_type;
                    }
                    b"Undefined" => {
                        self.check_no_type_arguments(node, SymbolId::NIL);
                        return self.undefined_type;
                    }
                    b"Null" => {
                        self.check_no_type_arguments(node, SymbolId::NIL);
                        return self.null_type;
                    }
                    b"Function" | b"function" => {
                        self.check_no_type_arguments(node, SymbolId::NIL);
                        return self.global_function_type;
                    }
                    b"array" => {
                        if type_args.is_empty() && !self.no_implicit_any {
                            return self.any_array_type;
                        }
                    }
                    b"promise" => {
                        if type_args.is_empty() && !self.no_implicit_any {
                            let any_type = self.any_type;
                            return self.create_promise_type(any_type);
                        }
                    }
                    b"Object" => {
                        if type_args.len() == 2 {
                            let record_symbol = self.get_global_record_symbol();
                            if !record_symbol.is_nil() {
                                let index_type = self.get_type_from_type_node(at(type_args, 0));
                                if self.is_valid_index_key_type(index_type) {
                                    let value_type = self.get_type_from_type_node(at(type_args, 1));
                                    return self.get_type_alias_instantiation(
                                        record_symbol,
                                        List::from_slice(&[index_type, value_type]),
                                        TypeAliasId::NIL,
                                    );
                                }
                            }
                            return self.any_type;
                        }
                        if !self.no_implicit_any {
                            self.check_no_type_arguments(node, SymbolId::NIL);
                            return self.any_type;
                        }
                    }
                    _ => {}
                }
            }
        }
        TypeId::NIL
    }

    pub fn get_symbol_from_type_reference(&mut self, node: NodeId) -> SymbolId {
        let links = self.symbol_node_links.get(node);
        if self.symbol_node_links[links].resolved_symbol.is_nil() {
            // The `const` in a `const` assertion resolves to nothing; resolveName knows not to report an error for it, so no special-casing is needed here.
            let symbol = self.resolve_type_reference_name(node, SymbolFlags::TYPE, false);
            self.symbol_node_links[links].resolved_symbol = symbol;
        }
        self.symbol_node_links[links].resolved_symbol
    }

    pub fn resolve_type_reference_name(
        &mut self,
        type_reference: NodeId,
        meaning: SymbolFlags,
        ignore_errors: bool,
    ) -> SymbolId {
        let name = get_type_reference_name(self.ast, type_reference);
        if name.is_nil() {
            return self.unknown_symbol;
        }
        let symbol = self.resolve_entity_name(name, meaning, ignore_errors, false, NodeId::NIL);
        if !symbol.is_nil() && symbol != self.unknown_symbol {
            return symbol;
        }
        if ignore_errors {
            return self.unknown_symbol;
        }
        self.get_unresolved_symbol_for_entity_name(name)
    }

    pub fn get_unresolved_symbol_for_entity_name(&mut self, name: NodeId) -> SymbolId {
        if !self.stack_check.is_safe_to_recurse() {
            let _: () = self.stack_limit();
            return self.unknown_symbol;
        }
        let a = self.ast;
        let identifier = match a.kind(name) {
            Kind::QualifiedName => a.as_qualified_name(name).right,
            Kind::PropertyAccessExpression => a.name(name),
            _ => name,
        };
        let text = a.text(identifier);
        if !text.is_empty() {
            let mut parent_symbol = SymbolId::NIL;
            match a.kind(name) {
                Kind::QualifiedName => {
                    parent_symbol =
                        self.get_unresolved_symbol_for_entity_name(a.as_qualified_name(name).left);
                }
                Kind::PropertyAccessExpression => {
                    parent_symbol = self.get_unresolved_symbol_for_entity_name(a.expression(name));
                }
                _ => {}
            }
            let mut path: Vec<u8> = Vec::new();
            if !parent_symbol.is_nil() {
                path = get_symbol_path(self, parent_symbol);
                path.push(b'.');
            }
            path.extend_from_slice(text);
            let path = self.text(&path);
            let mut result = self.unresolved_symbols.get(&path);
            if result.is_nil() {
                result = self.new_symbol_ex(SymbolFlags::TYPE_ALIAS, text, CheckFlags::UNRESOLVED);
                let ok = self.unresolved_symbols.set(path, result);
                self.map_set(ok);
                a.update_symbol(result, |s| s.parent = parent_symbol);
                let unresolved_type = self.unresolved_type;
                let links = self.type_alias_links.get(result);
                self.type_alias_links[links].declared_type = unresolved_type;
            }
            return result;
        }
        self.unknown_symbol
    }
}

pub fn get_symbol_path(c: &Checker<'_>, symbol: SymbolId) -> Vec<u8> {
    if !c.stack_check.is_safe_to_recurse() {
        let _: () = c.stack_limit();
        return Vec::new();
    }
    let s = c.ast.sym(symbol);
    if !s.parent.is_nil() {
        let mut path = get_symbol_path(c, s.parent);
        path.push(b'.');
        path.extend_from_slice(s.name);
        return path;
    }
    s.name.to_vec()
}

impl<'a> Checker<'a> {
    pub fn get_type_reference_type(&mut self, node: NodeId, symbol: SymbolId) -> TypeId {
        if symbol == self.unknown_symbol {
            return self.error_type;
        }
        let flags = self.ast.sym(symbol).flags;
        if flags.intersects(SymbolFlags::CLASS | SymbolFlags::INTERFACE) {
            return self.get_type_from_class_or_interface_reference(node, symbol);
        }
        if flags.intersects(SymbolFlags::TYPE_ALIAS) {
            return self.get_type_from_type_alias_reference(node, symbol);
        }
        // Get type from reference to named type that cannot be generic (enum or type parameter)
        let res = self.try_get_declared_type_of_symbol(symbol);
        if !res.is_nil() && self.check_no_type_arguments(node, symbol) {
            return self.get_regular_type_of_literal_type(res);
        }
        // Upstream does not resolve values as types for JS here.
        self.error_type
    }

    // Get type from type-reference that reference to class or interface
    pub fn get_type_from_class_or_interface_reference(
        &mut self,
        node: NodeId,
        symbol: SymbolId,
    ) -> TypeId {
        let a = self.ast;
        let merged_symbol = self.get_merged_symbol(symbol);
        let t = self.get_declared_type_of_class_or_interface(merged_symbol);
        let type_parameters = self.as_interface_type(t).local_type_parameters();
        let type_parameter_count = type_parameters.as_slice().len() as isize;
        if type_parameter_count != 0 {
            let num_type_arguments = a.type_arguments(node).as_slice().len() as isize;
            let min_type_argument_count = self.get_min_type_argument_count(type_parameters);
            let is_js = is_in_js_file(a, node);
            let is_js_implicit_any = !self.no_implicit_any && is_js;
            if !is_js_implicit_any
                && (num_type_arguments < min_type_argument_count
                    || num_type_arguments > type_parameter_count)
            {
                let missing_augments_tag = is_js
                    && is_expression_with_type_arguments(a, node)
                    && !is_jsdoc_augments_tag(a, a.parent(node));
                let message = if missing_augments_tag {
                    if min_type_argument_count < type_parameter_count {
                        diagnostics::EXPECTED_0_1_TYPE_ARGUMENTS_PROVIDE_THESE_WITH_AN_EXTENDS_TAG
                    } else {
                        diagnostics::EXPECTED_0_TYPE_ARGUMENTS_PROVIDE_THESE_WITH_AN_EXTENDS_TAG
                    }
                } else if min_type_argument_count < type_parameter_count {
                    diagnostics::GENERIC_TYPE_0_REQUIRES_BETWEEN_1_AND_2_TYPE_ARGUMENTS
                } else {
                    diagnostics::GENERIC_TYPE_0_REQUIRES_1_TYPE_ARGUMENT_S
                };
                let type_str = self.type_to_string_ex_exported(
                    t,
                    NodeId::NIL,
                    TypeFormatFlags::WRITE_ARRAY_AS_GENERIC_TYPE,
                    None,
                );
                self.error(
                    node,
                    message,
                    &[
                        Arg::Str(&type_str),
                        Arg::Int(min_type_argument_count as i64),
                        Arg::Int(type_parameter_count as i64),
                    ],
                );
                if !is_js {
                    // Upstream notes that TS could adopt the permissive behavior of JS here, which needs a change in fillMissingTypeArguments.
                    return self.error_type;
                }
            }
            if a.kind(node) == Kind::TypeReference
                && self.is_deferred_type_reference_node(
                    node,
                    num_type_arguments != type_parameter_count,
                )
            {
                return self.create_deferred_type_reference(
                    t,
                    node,
                    TypeMapperId::NIL,
                    TypeAliasId::NIL,
                );
            }
            // In a type reference, the outer type parameters of the referenced class or interface are automatically supplied as type arguments and the type reference only specifies arguments for the local type parameters of the class or interface.
            let type_arguments_from_node = self.get_type_arguments_from_node(node);
            let local_type_arguments = self.fill_missing_type_arguments(
                type_arguments_from_node,
                type_parameters,
                min_type_argument_count,
                is_js,
            );
            let mut type_arguments: Vec<TypeId> = self
                .as_interface_type(t)
                .outer_type_parameters()
                .as_slice()
                .to_vec();
            type_arguments.extend_from_slice(local_type_arguments.as_slice());
            let type_arguments = self.list_of(&type_arguments);
            return self.create_type_reference_ex(t, type_arguments, ObjectFlags::FROM_TYPE_NODE);
        }
        if self.check_no_type_arguments(node, symbol) {
            return t;
        }
        self.error_type
    }

    pub fn get_type_arguments_from_node(&mut self, node: NodeId) -> List<'a, TypeId> {
        let nodes = self.ast.type_arguments(node);
        if nodes.is_nil() {
            return List::NIL;
        }
        let mut types: Vec<TypeId> = Vec::with_capacity(nodes.as_slice().len());
        for &type_node in nodes.as_slice() {
            types.push(self.get_type_from_type_node(type_node));
        }
        self.list_of(&types)
    }

    pub fn check_no_type_arguments(&mut self, node: NodeId, symbol: SymbolId) -> bool {
        let a = self.ast;
        if !a.type_arguments(node).as_slice().is_empty() {
            let type_name: Vec<u8> = if !symbol.is_nil() {
                self.symbol_to_string(symbol)
            } else {
                declaration_name_to_string(a, a.as_type_reference_node(node).type_name)
            };
            self.error(
                node,
                diagnostics::TYPE_0_IS_NOT_GENERIC,
                &[Arg::Str(&type_name)],
            );
            return false;
        }
        true
    }

    // Return true if the given type reference node is directly aliased or if it needs to be deferred because it is possibly contained in a circular chain of eagerly resolved types.
    pub fn is_deferred_type_reference_node(
        &mut self,
        node: NodeId,
        has_default_type_arguments: bool,
    ) -> bool {
        let a = self.ast;
        if !self.get_alias_symbol_for_type_node(node).is_nil() {
            return true;
        }
        if self.is_resolved_by_type_alias(node) {
            match a.kind(node) {
                Kind::ArrayType => {
                    return self.may_resolve_type_alias(a.as_array_type_node(node).element_type);
                }
                Kind::TupleType => {
                    for &element in a.elements(node).as_slice() {
                        if self.may_resolve_type_alias(element) {
                            return true;
                        }
                    }
                    return false;
                }
                Kind::TypeReference => {
                    if has_default_type_arguments {
                        return true;
                    }
                    for &type_argument in a.type_arguments(node).as_slice() {
                        if self.may_resolve_type_alias(type_argument) {
                            return true;
                        }
                    }
                    return false;
                }
                _ => {}
            }
            return self.fail("Unhandled case in isDeferredTypeReferenceNode");
        }
        false
    }

    // Return true when the given node is transitively contained in type constructs that eagerly resolve their constituent types. We include SyntaxKind.TypeReference because type arguments of type aliases are eagerly resolved.
    pub fn is_resolved_by_type_alias(&self, node: NodeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        let parent = a.parent(node);
        match a.kind(parent) {
            Kind::ParenthesizedType
            | Kind::NamedTupleMember
            | Kind::TypeReference
            | Kind::UnionType
            | Kind::IntersectionType
            | Kind::IndexedAccessType
            | Kind::ConditionalType
            | Kind::TypeOperator
            | Kind::ArrayType
            | Kind::TupleType => self.is_resolved_by_type_alias(parent),
            Kind::TypeAliasDeclaration | Kind::JSTypeAliasDeclaration => true,
            _ => false,
        }
    }

    // Return true if resolving the given node (i.e. getTypeFromTypeNode) possibly causes resolution of a type alias.
    pub fn may_resolve_type_alias(&mut self, node: NodeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        match a.kind(node) {
            Kind::TypeReference => {
                let symbol = self.resolve_type_reference_name(node, SymbolFlags::TYPE, false);
                a.sym(symbol).flags.intersects(SymbolFlags::TYPE_ALIAS)
            }
            Kind::TypeQuery => true,
            Kind::TypeOperator => {
                a.as_type_operator_node(node).operator != Kind::UniqueKeyword
                    && self.may_resolve_type_alias(a.type_node(node))
            }
            Kind::ParenthesizedType | Kind::OptionalType | Kind::NamedTupleMember => {
                self.may_resolve_type_alias(a.type_node(node))
            }
            Kind::RestType => {
                let type_node = a.type_node(node);
                a.kind(type_node) != Kind::ArrayType
                    || self.may_resolve_type_alias(a.as_array_type_node(type_node).element_type)
            }
            Kind::UnionType => {
                for &constituent in a.nodes(a.as_union_type_node(node).types).as_slice() {
                    if self.may_resolve_type_alias(constituent) {
                        return true;
                    }
                }
                false
            }
            Kind::IntersectionType => {
                for &constituent in a.nodes(a.as_intersection_type_node(node).types).as_slice() {
                    if self.may_resolve_type_alias(constituent) {
                        return true;
                    }
                }
                false
            }
            Kind::IndexedAccessType => {
                let data = a.as_indexed_access_type_node(node);
                self.may_resolve_type_alias(data.object_type)
                    || self.may_resolve_type_alias(data.index_type)
            }
            Kind::ConditionalType => {
                let data = a.as_conditional_type_node(node);
                self.may_resolve_type_alias(data.check_type)
                    || self.may_resolve_type_alias(data.extends_type)
                    || self.may_resolve_type_alias(data.true_type)
                    || self.may_resolve_type_alias(data.false_type)
            }
            _ => false,
        }
    }

    pub fn create_normalized_type_reference(
        &mut self,
        target: TypeId,
        type_arguments: List<'a, TypeId>,
    ) -> TypeId {
        if self.types[target]
            .object_flags
            .intersects(ObjectFlags::TUPLE)
        {
            return self.create_normalized_tuple_type(target, type_arguments);
        }
        self.create_type_reference(target, type_arguments)
    }

    pub fn create_normalized_tuple_type_ex(
        &mut self,
        target: TypeId,
        element_types: List<'a, TypeId>,
        object_flags: ObjectFlags,
    ) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let combined_flags = self.as_tuple_type(target).combined_flags;
        let element_infos = self.as_tuple_type(target).element_infos.as_slice();
        let readonly = self.as_tuple_type(target).readonly;
        if !combined_flags.intersects(ElementFlags::NON_REQUIRED) {
            // No need to normalize when we only have regular required elements
            return self.create_type_reference_ex(target, element_types, object_flags);
        }
        if combined_flags.intersects(ElementFlags::VARIADIC) {
            for (i, &e) in element_types.as_slice().iter().enumerate() {
                if i < element_infos.len()
                    && at(element_infos, i)
                        .flags
                        .intersects(ElementFlags::VARIADIC)
                    && self.types[e]
                        .flags
                        .intersects(TypeFlags::NEVER | TypeFlags::UNION)
                {
                    // Transform [A, ...(X | Y | Z)] into [A, ...X] | [A, ...Y] | [A, ...Z]
                    let unknown_type = self.unknown_type;
                    let check_types: Vec<TypeId> = element_types
                        .as_slice()
                        .iter()
                        .enumerate()
                        .map(|(j, &t)| {
                            if j < element_infos.len()
                                && at(element_infos, j)
                                    .flags
                                    .intersects(ElementFlags::VARIADIC)
                            {
                                t
                            } else {
                                unknown_type
                            }
                        })
                        .collect();
                    if self.check_cross_product_union(List::from_slice(&check_types)) {
                        return self.map_type(e, &mut |c, t| {
                            let mut replaced: Vec<TypeId> = element_types.as_slice().to_vec();
                            if let Some(slot) = replaced.get_mut(i) {
                                *slot = t;
                            }
                            let replaced = c.list_of(&replaced);
                            c.create_normalized_tuple_type_ex(target, replaced, object_flags)
                        });
                    }
                }
            }
        }
        // We have optional, rest, or variadic elements that may need normalizing. Normalization ensures that all variadic elements are generic and that the tuple type has one of the following layouts, disregarding variadic elements: (1) Zero or more required elements, followed by zero or more optional elements, followed by zero or one rest element. (2) Zero or more required elements, followed by a rest element, followed by zero or more required elements. In either layout, zero or more generic variadic elements may be present at any location. Note that the element types may contain an extra 'this' type argument that we want to ignore during normalization and then just append to the normalized element types.
        let mut n = TupleNormalizer::default();
        let all_element_types = element_types.as_slice();
        if all_element_types.len() < element_infos.len() {
            let _: () = self.fail("slice bounds out of range");
        }
        let normalized_count = all_element_types.len().min(element_infos.len());
        let types_to_normalize = all_element_types.get(..normalized_count).unwrap_or(&[]);
        if !n.normalize(self, types_to_normalize, element_infos) {
            return self.error_type;
        }
        if all_element_types.len() > element_infos.len() {
            n.types.push(at(all_element_types, element_infos.len()));
        }
        let tuple_target = self.get_tuple_target_type(List::from_slice(&n.infos), readonly);
        if tuple_target == self.empty_generic_type {
            return self.empty_object_type;
        }
        if !n.types.is_empty() {
            let types = self.list_of(&n.types);
            return self.create_type_reference_ex(tuple_target, types, object_flags);
        }
        tuple_target
    }

    pub fn create_normalized_tuple_type(
        &mut self,
        target: TypeId,
        element_types: List<'a, TypeId>,
    ) -> TypeId {
        self.create_normalized_tuple_type_ex(target, element_types, ObjectFlags::NONE)
    }
}

// The checker that upstream keeps in the normalizer is a parameter of its two methods here.
#[derive(Default)]
pub struct TupleNormalizer {
    pub types: Vec<TypeId>,
    pub infos: Vec<TupleElementInfo>,
    pub last_required_index: isize,
    pub first_rest_index: isize,
    pub last_optional_or_rest_index: isize,
}

impl TupleNormalizer {
    pub fn normalize(
        &mut self,
        c: &mut Checker<'_>,
        element_types: &[TypeId],
        element_infos: &[TupleElementInfo],
    ) -> bool {
        self.last_required_index = -1;
        self.first_rest_index = -1;
        self.last_optional_or_rest_index = -1;
        for (i, &t) in element_types.iter().enumerate() {
            let info = at(element_infos, i);
            if info.flags.intersects(ElementFlags::VARIADIC) {
                if c.types[t].flags.intersects(TypeFlags::ANY) {
                    self.add(
                        c,
                        t,
                        TupleElementInfo {
                            flags: ElementFlags::REST,
                            labeled_declaration: info.labeled_declaration,
                        },
                    );
                } else if c.types[t]
                    .flags
                    .intersects(TypeFlags::INSTANTIABLE_NON_PRIMITIVE)
                    || c.is_generic_mapped_type(t)
                {
                    // Generic variadic elements stay as they are.
                    self.add(c, t, info);
                } else if is_tuple_type(c, t) {
                    let spread_types = c.get_element_types(t).as_slice();
                    if spread_types.len() + self.types.len() >= 10_000 {
                        let current_node = c.current_node;
                        let message = if is_part_of_type_node(c.ast, current_node) {
                            diagnostics::TYPE_PRODUCES_A_TUPLE_TYPE_THAT_IS_TOO_LARGE_TO_REPRESENT
                        } else {
                            diagnostics::EXPRESSION_PRODUCES_A_TUPLE_TYPE_THAT_IS_TOO_LARGE_TO_REPRESENT
                        };
                        c.error(current_node, message, &[]);
                        return false;
                    }
                    // Spread variadic elements with tuple types into the resulting tuple.
                    let spread_infos = c.type_target_tuple_type(t).element_infos.as_slice();
                    for (j, &s) in spread_types.iter().enumerate() {
                        self.add(c, s, at(spread_infos, j));
                    }
                } else {
                    // Treat everything else as an array type and create a rest element.
                    let mut s = TypeId::NIL;
                    if c.is_array_like_type(t) {
                        let number_type = c.number_type;
                        s = c.get_index_type_of_type(t, number_type);
                    }
                    if s.is_nil() {
                        s = c.error_type;
                    }
                    self.add(
                        c,
                        s,
                        TupleElementInfo {
                            flags: ElementFlags::REST,
                            labeled_declaration: info.labeled_declaration,
                        },
                    );
                }
            } else {
                // Copy other element kinds with no change.
                self.add(c, t, info);
            }
        }
        // Turn optional elements preceding the last required element into required elements
        let last_required = usize::try_from(self.last_required_index).unwrap_or(0);
        for info in self.infos.iter_mut().take(last_required) {
            if info.flags.intersects(ElementFlags::OPTIONAL) {
                info.flags = ElementFlags::REQUIRED;
            }
        }
        if self.first_rest_index >= 0 && self.first_rest_index < self.last_optional_or_rest_index {
            // Turn elements between first rest and last optional/rest into a single rest element
            let first = usize::try_from(self.first_rest_index).unwrap_or(0);
            let last = usize::try_from(self.last_optional_or_rest_index).unwrap_or(0);
            let mut types: Vec<TypeId> = Vec::new();
            for i in first..=last {
                let mut t = at(&self.types, i);
                if at(&self.infos, i).flags.intersects(ElementFlags::VARIADIC) {
                    let number_type = c.number_type;
                    t = c.get_indexed_access_type(t, number_type);
                }
                types.push(t);
            }
            let union = c.get_union_type(List::from_slice(&types));
            if let Some(slot) = self.types.get_mut(first) {
                *slot = union;
            }
            let types_end = (last + 1).min(self.types.len());
            if first + 1 < types_end {
                self.types.drain(first + 1..types_end);
            }
            let infos_end = (last + 1).min(self.infos.len());
            if first + 1 < infos_end {
                self.infos.drain(first + 1..infos_end);
            }
        }
        true
    }

    pub fn add(&mut self, c: &mut Checker<'_>, t: TypeId, info: TupleElementInfo) {
        if info.flags.intersects(ElementFlags::REQUIRED) {
            self.last_required_index = self.types.len() as isize;
        }
        if info.flags.intersects(ElementFlags::REST) && self.first_rest_index < 0 {
            self.first_rest_index = self.types.len() as isize;
        }
        if info
            .flags
            .intersects(ElementFlags::OPTIONAL | ElementFlags::REST)
        {
            self.last_optional_or_rest_index = self.types.len() as isize;
        }
        let element_type =
            c.add_optionality_ex(t, true, info.flags.intersects(ElementFlags::OPTIONAL));
        self.types.push(element_type);
        self.infos.push(info);
    }
}

// Return count of starting consecutive tuple elements of the given kind(s)
pub fn get_start_element_count(t: &TupleType<'_>, flags: ElementFlags) -> isize {
    let infos = t.element_infos.as_slice();
    for (i, info) in infos.iter().enumerate() {
        if !info.flags.intersects(flags) {
            return i as isize;
        }
    }
    infos.len() as isize
}

// Return count of ending consecutive tuple elements of the given kind(s)
pub fn get_end_element_count(t: &TupleType<'_>, flags: ElementFlags) -> isize {
    let infos = t.element_infos.as_slice();
    let mut i = infos.len();
    while i > 0 {
        if !at(infos, i - 1).flags.intersects(flags) {
            return (infos.len() - i) as isize;
        }
        i -= 1;
    }
    infos.len() as isize
}

pub fn get_total_fixed_element_count(t: &TupleType<'_>) -> isize {
    t.fixed_length + get_end_element_count(t, ElementFlags::FIXED)
}

impl<'a> Checker<'a> {
    pub fn get_element_types(&mut self, t: TypeId) -> List<'a, TypeId> {
        let type_arguments = self.get_type_arguments(t);
        let arity = self.get_type_reference_arity(t);
        let all = type_arguments.as_slice();
        if all.len() as isize == arity {
            return type_arguments;
        }
        let end = usize::try_from(arity).unwrap_or(0).min(all.len());
        List::from_slice(all.get(..end).unwrap_or(&[]))
    }

    pub fn get_type_reference_arity(&self, t: TypeId) -> isize {
        let target = self.as_object_type(t).target;
        self.as_interface_type(target)
            .type_parameters()
            .as_slice()
            .len() as isize
    }

    pub fn is_array_type(&self, t: TypeId) -> bool {
        if !self.types[t]
            .object_flags
            .intersects(ObjectFlags::REFERENCE)
        {
            return false;
        }
        let target = self.as_object_type(t).target;
        target == self.global_array_type || target == self.global_readonly_array_type
    }

    pub fn is_readonly_array_type(&self, t: TypeId) -> bool {
        self.types[t]
            .object_flags
            .intersects(ObjectFlags::REFERENCE)
            && self.as_object_type(t).target == self.global_readonly_array_type
    }
}

pub fn is_tuple_type(c: &Checker<'_>, t: TypeId) -> bool {
    c.types[t].object_flags.intersects(ObjectFlags::REFERENCE)
        && c.types[c.as_object_type(t).target]
            .object_flags
            .intersects(ObjectFlags::TUPLE)
}

pub fn is_mutable_tuple_type(c: &Checker<'_>, t: TypeId) -> bool {
    is_tuple_type(c, t) && !c.type_target_tuple_type(t).readonly
}

pub fn is_generic_tuple_type(c: &Checker<'_>, t: TypeId) -> bool {
    is_tuple_type(c, t)
        && c.type_target_tuple_type(t)
            .combined_flags
            .intersects(ElementFlags::VARIADIC)
}

pub fn is_single_element_generic_tuple_type(c: &Checker<'_>, t: TypeId) -> bool {
    is_generic_tuple_type(c, t) && c.type_target_tuple_type(t).element_infos.as_slice().len() == 1
}

impl<'a> Checker<'a> {
    pub fn is_array_or_tuple_type(&self, t: TypeId) -> bool {
        self.is_array_type(t) || is_tuple_type(self, t)
    }

    pub fn is_mutable_array_or_tuple(&self, t: TypeId) -> bool {
        self.is_array_type(t) && !self.is_readonly_array_type(t)
            || is_tuple_type(self, t) && !self.type_target_tuple_type(t).readonly
    }

    pub fn get_element_type_of_array_type(&mut self, t: TypeId) -> TypeId {
        if self.is_array_type(t) {
            return at(self.get_type_arguments(t).as_slice(), 0);
        }
        TypeId::NIL
    }

    pub fn is_array_like_type(&mut self, t: TypeId) -> bool {
        // A type is array-like if it is a reference to the global Array or global ReadonlyArray type, or if it is not the undefined or null type and if it is assignable to ReadonlyArray<any>
        if self.is_array_type(t) {
            return true;
        }
        let any_readonly_array_type = self.any_readonly_array_type;
        !self.types[t].flags.intersects(TypeFlags::NULLABLE)
            && self.is_type_assignable_to(t, any_readonly_array_type)
    }

    pub fn is_mutable_array_like_type(&mut self, t: TypeId) -> bool {
        // A type is mutable-array-like if it is a reference to the global Array type, or if it is not the any, undefined or null type and if it is assignable to Array<any>
        if self.is_mutable_array_or_tuple(t) {
            return true;
        }
        let any_array_type = self.any_array_type;
        !self.types[t]
            .flags
            .intersects(TypeFlags::ANY | TypeFlags::NULLABLE)
            && self.is_type_assignable_to(t, any_array_type)
    }

    pub fn is_empty_array_literal_type(&mut self, t: TypeId) -> bool {
        let element_type = self.get_element_type_of_array_type(t);
        !element_type.is_nil() && self.is_empty_literal_type(element_type)
    }

    pub fn is_empty_literal_type(&self, t: TypeId) -> bool {
        if self.strict_null_checks {
            return t == self.implicit_never_type;
        }
        t == self.undefined_widening_type
    }

    pub fn is_tuple_like_type(&mut self, t: TypeId) -> bool {
        if is_tuple_type(self, t) || !self.get_property_of_type(t, b"0").is_nil() {
            return true;
        }
        if self.is_array_like_type(t) {
            let length_type = self.get_type_of_property_of_type(t, b"length");
            if !length_type.is_nil() {
                return every_type(self, length_type, &mut |c, u| {
                    c.types[u].flags.intersects(TypeFlags::NUMBER_LITERAL)
                });
            }
        }
        false
    }

    pub fn is_array_or_tuple_like_type(&mut self, t: TypeId) -> bool {
        self.is_array_like_type(t) || self.is_tuple_like_type(t)
    }

    pub fn is_array_or_tuple_or_intersection(&self, t: TypeId) -> bool {
        self.types[t].flags.intersects(TypeFlags::INTERSECTION)
            && self
                .type_types(t)
                .as_slice()
                .iter()
                .all(|&u| self.is_array_or_tuple_type(u))
    }

    pub fn get_tuple_element_type(&mut self, t: TypeId, index: isize) -> TypeId {
        let name = self.text(index.to_string().as_bytes());
        let prop_type = self.get_type_of_property_of_type(t, name);
        if !prop_type.is_nil() {
            return prop_type;
        }
        if every_type(self, t, &mut |c, u| is_tuple_type(c, u)) {
            let undefined_like_type =
                if self.compiler_options.no_unchecked_indexed_access == Tristate::TRUE {
                    self.undefined_type
                } else {
                    TypeId::NIL
                };
            return self.get_tuple_element_type_out_of_start_count(
                t,
                Number(index as f64),
                undefined_like_type,
            );
        }
        TypeId::NIL
    }

    // Get type from reference to type alias. When a type alias is generic, the declared type of the type alias may include references to the type parameters of the alias. We replace those with the actual type arguments by instantiating the declared type. Instantiations are cached using the type identities of the type arguments as the key.
    pub fn get_type_from_type_alias_reference(&mut self, node: NodeId, symbol: SymbolId) -> TypeId {
        let a = self.ast;
        let type_arguments = a.type_arguments(node);
        if a.sym(symbol).check_flags.intersects(CheckFlags::UNRESOLVED) {
            let alias_type_arguments = self.get_type_arguments_from_node(node);
            let alias = self.type_aliases.alloc(TypeAlias {
                symbol,
                type_arguments: alias_type_arguments,
            });
            let key = get_alias_key(self, alias);
            let mut error_type = self.error_types.get(&key);
            if error_type.is_nil() {
                error_type = self.new_intrinsic_type(TypeFlags::ANY, b"error");
                self.types[error_type].alias = alias;
                let ok = self.error_types.set(key, error_type);
                self.map_set(ok);
            }
            return error_type;
        }
        let t = self.get_declared_type_of_symbol(symbol);
        let links = self.type_alias_links.get(symbol);
        let type_parameters = self.type_alias_links[links].type_parameters;
        let type_parameter_count = type_parameters.as_slice().len() as isize;
        if type_parameter_count != 0 {
            let num_type_arguments = type_arguments.as_slice().len() as isize;
            let min_type_argument_count = self.get_min_type_argument_count(type_parameters);
            if num_type_arguments < min_type_argument_count
                || num_type_arguments > type_parameter_count
            {
                let message = if min_type_argument_count == type_parameter_count {
                    diagnostics::GENERIC_TYPE_0_REQUIRES_1_TYPE_ARGUMENT_S
                } else {
                    diagnostics::GENERIC_TYPE_0_REQUIRES_BETWEEN_1_AND_2_TYPE_ARGUMENTS
                };
                let symbol_name = self.symbol_to_string(symbol);
                self.error(
                    node,
                    message,
                    &[
                        Arg::Str(&symbol_name),
                        Arg::Int(min_type_argument_count as i64),
                        Arg::Int(type_parameter_count as i64),
                    ],
                );
                return self.error_type;
            }
            // We refrain from associating a local type alias with an instantiation of a top-level type alias because the local alias may end up being referenced in an inferred return type where it is not accessible--which in turn may lead to a large structural expansion of the type when generating a .d.ts file. See #43622 for an example.
            let alias_symbol = self.get_alias_symbol_for_type_node(node);
            let mut new_alias_symbol = SymbolId::NIL;
            if !alias_symbol.is_nil()
                && (is_local_type_alias(a, symbol) || !is_local_type_alias(a, alias_symbol))
            {
                new_alias_symbol = alias_symbol;
            }
            let mut alias_type_arguments: List<'a, TypeId> = List::NIL;
            if !new_alias_symbol.is_nil() {
                alias_type_arguments = self.get_type_arguments_for_alias_symbol(new_alias_symbol);
            } else if is_type_reference_type(a, node) {
                let alias_symbol = self.resolve_type_reference_name(node, SymbolFlags::ALIAS, true);
                // refers to an alias import/export/reexport - by making sure we use the target as an aliasSymbol, we ensure the exported symbol is used to refer to the type when it is reserialized later
                if !alias_symbol.is_nil() && alias_symbol != self.unknown_symbol {
                    let resolved = self.resolve_alias(alias_symbol);
                    if !resolved.is_nil()
                        && a.sym(resolved).flags.intersects(SymbolFlags::TYPE_ALIAS)
                    {
                        new_alias_symbol = resolved;
                        alias_type_arguments = self.get_type_arguments_from_node(node);
                    }
                }
            }
            let mut new_alias = TypeAliasId::NIL;
            if !new_alias_symbol.is_nil() {
                new_alias = self.type_aliases.alloc(TypeAlias {
                    symbol: new_alias_symbol,
                    type_arguments: alias_type_arguments,
                });
            }
            let type_arguments_from_node = self.get_type_arguments_from_node(node);
            return self.get_type_alias_instantiation(symbol, type_arguments_from_node, new_alias);
        }
        if self.check_no_type_arguments(node, symbol) {
            return t;
        }
        self.error_type
    }

    pub fn get_type_alias_instantiation(
        &mut self,
        symbol: SymbolId,
        type_arguments: List<'_, TypeId>,
        alias: TypeAliasId,
    ) -> TypeId {
        let a = self.ast;
        let t = self.get_declared_type_of_symbol(symbol);
        if t == self.intrinsic_marker_type {
            let type_kind = intrinsic_type_kinds(a.sym(symbol).name);
            if type_kind != IntrinsicTypeKind::UNKNOWN && type_arguments.as_slice().len() == 1 {
                let type_argument = at(type_arguments.as_slice(), 0);
                if type_kind == IntrinsicTypeKind::NO_INFER {
                    return self.get_no_infer_type(type_argument);
                }
                return self.get_string_mapping_type(symbol, type_argument);
            }
        }
        let links = self.type_alias_links.get(symbol);
        let type_parameters = self.type_alias_links[links].type_parameters;
        let key = get_type_alias_instantiation_key(self, type_arguments, alias);
        let mut instantiation = self.type_alias_links[links].instantiations.get(&key);
        if instantiation.is_nil() {
            let min_type_argument_count = self.get_min_type_argument_count(type_parameters);
            let is_js = is_in_js_file(a, a.sym(symbol).value_declaration);
            let stored_type_arguments = if type_arguments.is_nil() {
                List::NIL
            } else {
                self.list_of(type_arguments.as_slice())
            };
            let filled = self.fill_missing_type_arguments(
                stored_type_arguments,
                type_parameters,
                min_type_argument_count,
                is_js,
            );
            let mapper = new_type_mapper(self, type_parameters, filled);
            instantiation = self.instantiate_type_with_alias(t, mapper, alias);
            // The map is nil for an alias without type parameters or with a circular declared type: the instantiation is then not cached.
            let ok = self.type_alias_links[links]
                .instantiations
                .set(key, instantiation);
            self.map_set(ok);
        }
        instantiation
    }
}

pub fn is_local_type_alias(a: Ast<'_>, symbol: SymbolId) -> bool {
    let declarations = a.sym(symbol).declarations;
    let declaration = declarations
        .as_slice()
        .iter()
        .find(|&&d| is_type_alias(a, d));
    match declaration {
        Some(&declaration) => !get_containing_function(a, declaration).is_nil(),
        None => false,
    }
}

impl<'a> Checker<'a> {
    pub fn get_declared_type_of_symbol(&mut self, symbol: SymbolId) -> TypeId {
        let result = self.try_get_declared_type_of_symbol(symbol);
        if result.is_nil() {
            return self.error_type;
        }
        result
    }

    pub fn try_get_declared_type_of_symbol(&mut self, symbol: SymbolId) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let flags = self.ast.sym(symbol).flags;
        if flags.intersects(SymbolFlags::CLASS | SymbolFlags::INTERFACE) {
            return self.get_declared_type_of_class_or_interface(symbol);
        }
        if flags.intersects(SymbolFlags::TYPE_PARAMETER) {
            return self.get_declared_type_of_type_parameter(symbol);
        }
        if flags.intersects(SymbolFlags::TYPE_ALIAS) {
            return self.get_declared_type_of_type_alias(symbol);
        }
        if flags.intersects(SymbolFlags::ENUM) {
            return self.get_declared_type_of_enum(symbol);
        }
        if flags.intersects(SymbolFlags::ENUM_MEMBER) {
            return self.get_declared_type_of_enum_member(symbol);
        }
        if flags.intersects(SymbolFlags::ALIAS) {
            return self.get_declared_type_of_alias(symbol);
        }
        TypeId::NIL
    }
}

pub fn get_type_reference_name(a: Ast<'_>, node: NodeId) -> NodeId {
    match a.kind(node) {
        Kind::TypeReference => return a.as_type_reference_node(node).type_name,
        Kind::ExpressionWithTypeArguments => {
            // We only support expressions that are simple qualified names. For other expressions this produces nil
            let expr = a.expression(node);
            if is_entity_name_expression(a, expr) {
                return expr;
            }
        }
        _ => {}
    }
    NodeId::NIL
}

impl<'a> Checker<'a> {
    pub fn get_alias_for_type_node(&mut self, node: NodeId) -> TypeAliasId {
        let symbol = self.get_alias_symbol_for_type_node(node);
        if !symbol.is_nil() {
            let type_arguments = self.get_type_arguments_for_alias_symbol(symbol);
            return self.type_aliases.alloc(TypeAlias {
                symbol,
                type_arguments,
            });
        }
        TypeAliasId::NIL
    }

    pub fn get_alias_symbol_for_type_node(&mut self, node: NodeId) -> SymbolId {
        let a = self.ast;
        let mut host = a.parent(node);
        while is_parenthesized_type_node(a, host)
            || is_type_operator_node(a, host)
                && a.as_type_operator_node(host).operator == Kind::ReadonlyKeyword
        {
            host = a.parent(host);
        }
        if is_type_alias(a, host) {
            return self.get_symbol_of_declaration(host);
        }
        SymbolId::NIL
    }

    pub fn get_type_arguments_for_alias_symbol(&mut self, symbol: SymbolId) -> List<'a, TypeId> {
        if !symbol.is_nil() {
            return self.get_local_type_parameters_of_class_or_interface_or_type_alias(symbol);
        }
        List::NIL
    }

    pub fn get_outer_type_parameters_of_class_or_interface(
        &mut self,
        symbol: SymbolId,
    ) -> List<'a, TypeId> {
        let declaration = self.get_class_or_interface_like_declaration(symbol);
        self.assert(
            !declaration.is_nil(),
            "Class was missing valueDeclaration -OR- non-class had no interface declarations",
        );
        self.get_outer_type_parameters(declaration, false)
    }

    // Returns the declaration used to obtain a class, interface, or function symbol's outer type parameters.
    pub fn get_class_or_interface_like_declaration(&self, symbol: SymbolId) -> NodeId {
        let a = self.ast;
        let s = a.sym(symbol);
        if s.flags
            .intersects(SymbolFlags::CLASS | SymbolFlags::FUNCTION)
        {
            return s.value_declaration;
        }
        for &d in s.declarations.as_slice() {
            if is_interface_declaration(a, d) {
                return d;
            }
            if !is_variable_declaration(a, d) {
                continue;
            }
            let initializer = a.initializer(d);
            if !initializer.is_nil() && is_function_expression_or_arrow_function(a, initializer) {
                return d;
            }
        }
        NodeId::NIL
    }

    pub fn can_get_type_parameters_of_class_or_interface(&self, symbol: SymbolId) -> bool {
        !self
            .get_class_or_interface_like_declaration(symbol)
            .is_nil()
    }
}
