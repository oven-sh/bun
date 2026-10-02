// checker.go:20115-20727 (layers T-SIGDECL, T-RETINFER, T-WIDEN, T-SIGINST): return types of signatures, full signature types, annotated accessor types, the return type that a function body gives with its promise and generator types, errors from widening, the type predicate that a function body gives, and the optional type marker.
use crate::ast::{
    Arg, Ast, FlowFlags, FlowNodeId, FunctionFlags, Kind, NodeId, for_each_return_statement,
    get_declaration_of_kind, get_function_flags, get_name_of_declaration, is_await_expression,
    is_block, is_call_expression, is_constructor_declaration, is_function_declaration,
    is_function_expression_or_arrow_function, is_function_like_declaration,
    is_get_accessor_declaration, is_identifier, is_import_call, is_in_js_file,
    is_method_declaration, is_object_literal_expression, is_return_statement, node_is_missing,
    skip_parentheses,
};
use crate::checker::{
    CheckMode, Checker, ContextFlags, IterationTypeKind, IterationTypesResolverKind, IterationUse,
    ObjectFlags, SignatureFlags, SignatureId, TypeAliasId, TypeFlags, TypeId, TypePredicateId,
    TypePredicateKind, TypeSystemEntity, TypeSystemPropertyName, UnionReduction, WideningKind,
    for_each_yield_expression, get_flow_node_of_node, get_set_accessor_value_parameter,
    is_object_literal_type, is_rest_parameter, is_unit_type, some_type,
};
use crate::core::{List, append_if_unique, find, if_else, or_else};
use crate::diagnostics;
use crate::scanner::declaration_name_to_string;

impl<'a> Checker<'a> {
    pub fn get_return_type_of_signature(&mut self, sig: SignatureId) -> TypeId {
        let a = self.ast;
        if !self.signatures[sig].resolved_return_type.is_nil() {
            return self.signatures[sig].resolved_return_type;
        }
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if !self.push_type_resolution(
            TypeSystemEntity::Signature(sig),
            TypeSystemPropertyName::ResolvedReturnType,
        ) {
            return self.error_type;
        }
        let target = self.signatures[sig].target;
        let composite = self.signatures[sig].composite;
        let mut t;
        if !target.is_nil() {
            let target_return_type = self.get_return_type_of_signature(target);
            let mapper = self.signatures[sig].mapper;
            t = self.instantiate_type(target_return_type, mapper);
        } else if !composite.is_nil() {
            let signatures = self.composite_signatures[composite].signatures;
            let mut return_types: Vec<TypeId> = Vec::with_capacity(signatures.as_slice().len());
            for &signature in signatures.as_slice() {
                let return_type = self.get_return_type_of_signature(signature);
                return_types.push(return_type);
            }
            let is_union = self.composite_signatures[composite].is_union;
            let composite_type = self.get_union_or_intersection_type(
                List::from_slice(&return_types),
                is_union,
                UnionReduction::SUBTYPE,
            );
            let mapper = self.signatures[sig].mapper;
            t = self.instantiate_type(composite_type, mapper);
        } else {
            let declaration = self.signatures[sig].declaration;
            t = self.get_return_type_from_annotation(declaration);
            if t.is_nil() {
                if !node_is_missing(a, a.body(declaration)) {
                    t = self.get_return_type_from_body(declaration, CheckMode::NORMAL);
                } else {
                    t = self.any_type;
                }
            }
        }
        let flags = self.signatures[sig].flags;
        if flags.intersects(SignatureFlags::IS_INNER_CALL_CHAIN) {
            t = self.add_optional_type_marker(t);
        } else if flags.intersects(SignatureFlags::IS_OUTER_CALL_CHAIN) {
            t = self.get_optional_type(t, false);
        }
        if !self.pop_type_resolution() {
            let declaration = self.signatures[sig].declaration;
            if !declaration.is_nil() {
                let type_node = a.type_node(declaration);
                if !type_node.is_nil() {
                    self.error(
                        type_node,
                        diagnostics::RETURN_TYPE_ANNOTATION_CIRCULARLY_REFERENCES_ITSELF,
                        &[],
                    );
                } else if self.no_implicit_any {
                    let name = get_name_of_declaration(a, declaration);
                    if !name.is_nil() {
                        let name_text = declaration_name_to_string(a, name);
                        self.error(
                            name,
                            diagnostics::X_0_IMPLICITLY_HAS_RETURN_TYPE_ANY_BECAUSE_IT_DOES_NOT_HAVE_A_RETURN_TYPE_ANNOTATION_AND_IS_REFERENCED_DIRECTLY_OR_INDIRECTLY_IN_ONE_OF_ITS_RETURN_EXPRESSIONS,
                            &[Arg::Str(&name_text)],
                        );
                    } else {
                        self.error(
                            declaration,
                            diagnostics::FUNCTION_IMPLICITLY_HAS_RETURN_TYPE_ANY_BECAUSE_IT_DOES_NOT_HAVE_A_RETURN_TYPE_ANNOTATION_AND_IS_REFERENCED_DIRECTLY_OR_INDIRECTLY_IN_ONE_OF_ITS_RETURN_EXPRESSIONS,
                            &[],
                        );
                    }
                }
            }
            t = self.any_type;
        }
        if self.signatures[sig].resolved_return_type.is_nil() {
            self.signatures[sig].resolved_return_type = t;
        }
        self.signatures[sig].resolved_return_type
    }

    pub fn get_non_circular_return_type_of_signature(&mut self, sig: SignatureId) -> TypeId {
        if self.is_resolving_return_type_of_signature(sig) {
            return self.any_type;
        }
        self.get_return_type_of_signature(sig)
    }

    pub fn get_return_type_from_annotation(&mut self, declaration: NodeId) -> TypeId {
        let a = self.ast;
        if is_constructor_declaration(a, declaration) {
            let class_symbol = self.get_merged_symbol(a.symbol(a.parent(declaration)));
            return self.get_declared_type_of_class_or_interface(class_symbol);
        }
        let return_type = a.type_node(declaration);
        if !return_type.is_nil() {
            return self.get_type_from_type_node(return_type);
        }
        if is_get_accessor_declaration(a, declaration) && self.has_bindable_name(declaration) {
            let symbol = self.get_symbol_of_declaration(declaration);
            let setter = get_declaration_of_kind(a, symbol, Kind::SetAccessor);
            return self.get_annotated_accessor_type(setter);
        }
        self.get_return_type_of_full_signature(declaration)
    }

    pub fn get_signature_of_full_signature_type(&mut self, node: NodeId) -> SignatureId {
        let a = self.ast;
        if is_in_js_file(a, node)
            && (is_function_declaration(a, node)
                || is_method_declaration(a, node)
                || is_function_expression_or_arrow_function(a, node))
        {
            let full_signature = a
                .function_like_data(node)
                .map_or(NodeId::NIL, |data| data.full_signature);
            if !full_signature.is_nil() {
                let full_signature_type = self.get_type_from_type_node(full_signature);
                return self.get_single_call_signature(full_signature_type);
            }
        }
        SignatureId::NIL
    }

    pub fn get_parameter_type_of_full_signature(
        &mut self,
        node: NodeId,
        parameter: NodeId,
    ) -> TypeId {
        let a = self.ast;
        let signature = self.get_signature_of_full_signature_type(node);
        if !signature.is_nil() {
            let pos = a
                .parameters(node)
                .as_slice()
                .iter()
                .position(|&p| p == parameter)
                .map_or(-1, |pos| pos as isize);
            if !a
                .as_parameter_declaration(parameter)
                .dot_dot_dot_token
                .is_nil()
            {
                return self.get_rest_type_at_position(signature, pos, false);
            } else {
                return self.get_type_at_position(signature, pos);
            }
        }
        TypeId::NIL
    }

    pub fn get_return_type_of_full_signature(&mut self, node: NodeId) -> TypeId {
        let signature = self.get_signature_of_full_signature_type(node);
        if !signature.is_nil() {
            return self.get_return_type_of_signature(signature);
        }
        TypeId::NIL
    }

    pub fn get_annotated_accessor_type(&mut self, accessor: NodeId) -> TypeId {
        let node = self.get_annotated_accessor_type_node(accessor);
        if !node.is_nil() {
            return self.get_type_from_type_node(node);
        }
        TypeId::NIL
    }

    pub fn get_annotated_accessor_type_node(&self, accessor: NodeId) -> NodeId {
        let a = self.ast;
        if !accessor.is_nil() {
            match a.kind(accessor) {
                Kind::GetAccessor | Kind::PropertyDeclaration => return a.type_node(accessor),
                Kind::SetAccessor => {
                    return get_effective_set_accessor_type_annotation_node(a, accessor);
                }
                _ => {}
            }
        }
        NodeId::NIL
    }
}

pub fn get_effective_set_accessor_type_annotation_node(a: Ast<'_>, node: NodeId) -> NodeId {
    let param = get_set_accessor_value_parameter(a, node);
    if !param.is_nil() {
        return a.type_node(param);
    }
    NodeId::NIL
}

impl<'a> Checker<'a> {
    pub fn report_errors_from_widening(
        &mut self,
        declaration: NodeId,
        t: TypeId,
        widening_kind: WideningKind,
    ) {
        if self.no_implicit_any
            && self.types[t]
                .object_flags
                .intersects(ObjectFlags::CONTAINS_WIDENING_TYPE)
        {
            if widening_kind == WideningKind::NORMAL
                || is_function_like_declaration(self.ast, declaration)
                    && self.should_report_errors_from_widening_with_contextual_signature(
                        declaration,
                        widening_kind,
                    )
            {
                // Report implicit any error within type if possible, otherwise report error on declaration
                if !self.report_widening_errors_in_type(t) {
                    self.report_implicit_any(declaration, t, widening_kind);
                }
            }
        }
    }

    pub fn should_report_errors_from_widening_with_contextual_signature(
        &mut self,
        declaration: NodeId,
        widening_kind: WideningKind,
    ) -> bool {
        let signature = self.get_contextual_signature_for_function_like_declaration(declaration);
        if signature.is_nil() {
            return true;
        }
        let mut return_type = self.get_return_type_of_signature(signature);
        let flags = get_function_flags(self.ast, declaration);
        if widening_kind == WideningKind::FUNCTION_RETURN {
            if flags.intersects(FunctionFlags::GENERATOR) {
                let iteration_type = self.get_iteration_type_of_generator_function_return_type(
                    IterationTypeKind::RETURN,
                    return_type,
                    flags.intersects(FunctionFlags::ASYNC),
                );
                if !iteration_type.is_nil() {
                    return_type = iteration_type;
                }
            } else if flags.intersects(FunctionFlags::ASYNC) {
                let awaited_type = self.get_awaited_type_no_alias(return_type);
                if !awaited_type.is_nil() {
                    return_type = awaited_type;
                }
            }
            return self.is_generic_type(return_type);
        }
        if widening_kind == WideningKind::GENERATOR_YIELD {
            let yield_type = self.get_iteration_type_of_generator_function_return_type(
                IterationTypeKind::YIELD,
                return_type,
                flags.intersects(FunctionFlags::ASYNC),
            );
            return !yield_type.is_nil() && self.is_generic_type(yield_type);
        }
        if widening_kind == WideningKind::GENERATOR_NEXT {
            let next_type = self.get_iteration_type_of_generator_function_return_type(
                IterationTypeKind::NEXT,
                return_type,
                flags.intersects(FunctionFlags::ASYNC),
            );
            return !next_type.is_nil() && self.is_generic_type(next_type);
        }
        false
    }

    // Reports implicit any errors that occur as a result of widening 'null' and 'undefined' to 'any'. A call to reportWideningErrorsInType is normally accompanied by a call to getWidenedType. But in some cases getWidenedType is called without reporting errors (type argument inference is an example). The return value indicates whether an error was in fact reported. The particular circumstances are on a best effort basis. Currently, if the null or undefined that causes widening is inside an object literal property (arbitrarily deeply), this function reports an error. If no error is reported, reportImplicitAnyError is a suitable fallback to report a general error.
    pub fn report_widening_errors_in_type(&mut self, t: TypeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        let mut error_reported = false;
        if self.types[t]
            .object_flags
            .intersects(ObjectFlags::CONTAINS_WIDENING_TYPE)
        {
            if self.types[t].flags.intersects(TypeFlags::UNION) {
                let types = self.type_types(t);
                if types
                    .as_slice()
                    .iter()
                    .any(|&s| self.is_empty_object_type(s))
                {
                    error_reported = true;
                } else {
                    for &s in types.as_slice() {
                        error_reported = error_reported || self.report_widening_errors_in_type(s);
                    }
                }
            } else if self.is_array_or_tuple_type(t) {
                let type_arguments = self.get_type_arguments(t);
                for &s in type_arguments.as_slice() {
                    error_reported = error_reported || self.report_widening_errors_in_type(s);
                }
            } else if is_object_literal_type(self, t) {
                let properties = self.get_properties_of_object_type(t);
                for &p in properties.as_slice() {
                    let s = self.get_type_of_symbol(p);
                    if self.types[s]
                        .object_flags
                        .intersects(ObjectFlags::CONTAINS_WIDENING_TYPE)
                    {
                        error_reported = self.report_widening_errors_in_type(s);
                        if !error_reported {
                            // we need to account for property types coming from object literal type normalization in unions
                            let type_declaration = a.sym(self.types[t].symbol).value_declaration;
                            let value_declaration = find(a.sym(p).declarations.as_slice(), |d| {
                                let value_declaration = a.sym(a.symbol(d)).value_declaration;
                                !value_declaration.is_nil()
                                    && a.parent(value_declaration) == type_declaration
                            });
                            if !value_declaration.is_nil() {
                                let name = self.symbol_to_string(p);
                                let widened_type = self.get_widened_type(s);
                                let type_text = self.type_to_string_exported(widened_type);
                                self.error(
                                    value_declaration,
                                    diagnostics::OBJECT_LITERAL_S_PROPERTY_0_IMPLICITLY_HAS_AN_1_TYPE,
                                    &[Arg::Str(&name), Arg::Str(&type_text)],
                                );
                                error_reported = true;
                            }
                        }
                    }
                }
            }
        }
        error_reported
    }

    pub fn add_optional_type_marker(&mut self, t: TypeId) -> TypeId {
        if self.strict_null_checks {
            return self.get_union_type(List::from_slice(&[t, self.optional_type]));
        }
        t
    }
}
