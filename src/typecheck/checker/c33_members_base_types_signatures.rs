// checker.go:18960-20113 (layers T-SIGINST, T-SIGDECL): the functions of 19407-19610 and 19920-20113: instantiations, clones, erasures and canonical forms of signatures, the single signature of a type, signatures of symbols and declarations, and late-bindable names.
use crate::ast::{
    Ast, INTERNAL_SYMBOL_NAME_THIS, Kind, ModifierFlags, NodeFlags, NodeId, SymbolFlags, SymbolId,
    SymbolTableId, get_declaration_of_kind, get_immediately_invoked_function_expression,
    get_name_of_declaration, get_this_parameter, has_dynamic_name, has_syntactic_modifier,
    is_arrow_function, is_binding_pattern, is_computed_property_name,
    is_construct_signature_declaration, is_constructor_declaration, is_constructor_type_node,
    is_element_access_expression, is_entity_name_expression, is_function_declaration,
    is_function_expression, is_function_like, is_get_accessor_declaration, is_in_js_file,
    is_method_or_accessor, is_set_accessor_declaration,
};
use crate::checker::{
    CachedSignatureKey, Checker, ContextFlags, InferenceContextId, InferenceFlags,
    InferencePriority, ObjectFlags, SignatureFlags, SignatureId, SignatureKind, TypeComparer,
    TypeFlags, TypeId, TypeMapperId, TypePredicateId, get_type_list_key, has_rest_parameter,
    is_optional_declaration, is_rest_parameter, is_type_usable_as_property_name,
    new_array_to_single_type_mapper, new_type_mapper, signature_key_base, signature_key_canonical,
    signature_key_erased,
};
use crate::core::{List, append_if_unique};
use crate::diagnostics::MessageId;

impl<'a> Checker<'a> {
    pub fn get_signature_instantiation(
        &mut self,
        sig: SignatureId,
        type_arguments: List<'a, TypeId>,
        is_java_script: bool,
        inferred_type_parameters: List<'a, TypeId>,
    ) -> SignatureId {
        let type_parameters = self.signatures[sig].type_parameters;
        let min_type_argument_count = self.get_min_type_argument_count(type_parameters);
        let filled_type_arguments = self.fill_missing_type_arguments(
            type_arguments,
            type_parameters,
            min_type_argument_count,
            is_java_script,
        );
        let instantiated_signature = self
            .get_signature_instantiation_without_filling_in_type_arguments(
                sig,
                filled_type_arguments,
            );
        if inferred_type_parameters.len() != 0 {
            let return_type = self.get_return_type_of_signature(instantiated_signature);
            let return_signature = self.get_single_call_or_construct_signature(return_type);
            if !return_signature.is_nil() {
                let new_return_signature = self.clone_signature(return_signature);
                self.signatures[new_return_signature].type_parameters = inferred_type_parameters;
                let new_return_type = self.get_or_create_type_from_signature(new_return_signature);
                let mapper = self.signatures[instantiated_signature].mapper;
                self.as_object_type_mut(new_return_type).mapper = mapper;
                let new_instantiated_signature = self.clone_signature(instantiated_signature);
                self.signatures[new_instantiated_signature].resolved_return_type = new_return_type;
                return new_instantiated_signature;
            }
        }
        instantiated_signature
    }

    pub fn clone_signature(&mut self, sig: SignatureId) -> SignatureId {
        let flags = self.signatures[sig].flags & SignatureFlags::PROPAGATING_FLAGS;
        let declaration = self.signatures[sig].declaration;
        let type_parameters = self.signatures[sig].type_parameters;
        let this_parameter = self.signatures[sig].this_parameter;
        let parameters = self.signatures[sig].parameters;
        let min_argument_count = self.signatures[sig].min_argument_count as isize;
        let result = self.new_signature(
            flags,
            declaration,
            type_parameters,
            this_parameter,
            parameters,
            TypeId::NIL,
            TypePredicateId::NIL,
            min_argument_count,
        );
        let target = self.signatures[sig].target;
        let mapper = self.signatures[sig].mapper;
        let composite = self.signatures[sig].composite;
        self.signatures[result].target = target;
        self.signatures[result].mapper = mapper;
        self.signatures[result].composite = composite;
        result
    }

    pub fn get_signature_instantiation_without_filling_in_type_arguments(
        &mut self,
        sig: SignatureId,
        type_arguments: List<'a, TypeId>,
    ) -> SignatureId {
        let key = CachedSignatureKey {
            sig,
            key: get_type_list_key(type_arguments),
        };
        let mut instantiation = self.cached_signatures.get(&key);
        if instantiation.is_nil() {
            instantiation = self.create_signature_instantiation(sig, type_arguments);
            let ok = self.cached_signatures.set(key, instantiation);
            self.map_set(ok);
        }
        instantiation
    }

    pub fn create_signature_instantiation(
        &mut self,
        sig: SignatureId,
        type_arguments: List<'a, TypeId>,
    ) -> SignatureId {
        let mapper = self.create_signature_type_mapper(sig, type_arguments);
        self.instantiate_signature_ex(sig, mapper, true)
    }

    pub fn create_signature_type_mapper(
        &mut self,
        sig: SignatureId,
        type_arguments: List<'a, TypeId>,
    ) -> TypeMapperId {
        let type_parameters = self.get_type_parameters_for_mapper(sig);
        new_type_mapper(self, type_parameters, type_arguments)
    }

    pub fn get_type_parameters_for_mapper(&mut self, sig: SignatureId) -> List<'a, TypeId> {
        let type_parameters = self.signatures[sig].type_parameters;
        self.same_map(type_parameters, |c, tp| {
            let mapper = c.type_mapper(tp);
            c.instantiate_type(tp, mapper)
        })
    }

    // If type has a single call signature and no other members, return that signature. Otherwise, return nil.
    pub fn get_single_call_signature(&mut self, t: TypeId) -> SignatureId {
        self.get_single_signature(t, SignatureKind::CALL, false)
    }

    pub fn get_single_call_or_construct_signature(&mut self, t: TypeId) -> SignatureId {
        let call_sig = self.get_single_signature(t, SignatureKind::CALL, false);
        if !call_sig.is_nil() {
            return call_sig;
        }
        self.get_single_signature(t, SignatureKind::CONSTRUCT, false)
    }

    pub fn get_single_signature(
        &mut self,
        t: TypeId,
        kind: SignatureKind,
        allow_members: bool,
    ) -> SignatureId {
        if self.types[t].flags.intersects(TypeFlags::OBJECT) {
            let resolved = self.resolve_structured_type_members(t);
            let resolved = self.as_structured_type(resolved);
            if allow_members || resolved.properties.len() == 0 && resolved.index_infos.len() == 0 {
                let call_signatures = resolved.call_signatures();
                let construct_signatures = resolved.construct_signatures();
                if kind == SignatureKind::CALL
                    && call_signatures.len() == 1
                    && construct_signatures.len() == 0
                {
                    return call_signatures.at(0usize);
                }
                if kind == SignatureKind::CONSTRUCT
                    && construct_signatures.len() == 1
                    && call_signatures.len() == 0
                {
                    return construct_signatures.at(0usize);
                }
            }
        }
        SignatureId::NIL
    }

    pub fn get_or_create_type_from_signature(&mut self, sig: SignatureId) -> TypeId {
        // There are two ways to declare a construct signature, one is by declaring a class constructor using the constructor keyword, and the other is declaring a bare construct signature in an object type literal or interface (using the new keyword). Each way of declaring a constructor will result in a different declaration kind.
        if self.signatures[sig].isolated_signature_type.is_nil() {
            let a = self.ast;
            let declaration = self.signatures[sig].declaration;
            let mut kind = Kind::Unknown;
            if !declaration.is_nil() {
                kind = a.kind(declaration);
            }
            // If declaration is undefined, it is likely to be the signature of the default constructor.
            let is_constructor = kind == Kind::Unknown
                || kind == Kind::Constructor
                || kind == Kind::ConstructSignature
                || kind == Kind::ConstructorType;
            let mut symbol = SymbolId::NIL;
            if !declaration.is_nil() {
                symbol = a.symbol(declaration);
            }
            let t = self.new_object_type(
                ObjectFlags::ANONYMOUS | ObjectFlags::SINGLE_SIGNATURE_TYPE,
                symbol,
            );
            let signatures = self.list_of(&[sig]);
            if is_constructor {
                self.set_structured_type_members(
                    t,
                    SymbolTableId::NIL,
                    List::NIL,
                    signatures,
                    List::NIL,
                );
            } else {
                self.set_structured_type_members(
                    t,
                    SymbolTableId::NIL,
                    signatures,
                    List::NIL,
                    List::NIL,
                );
            }
            self.signatures[sig].isolated_signature_type = t;
        }
        self.signatures[sig].isolated_signature_type
    }

    pub fn get_erased_signature(&mut self, signature: SignatureId) -> SignatureId {
        let type_parameters = self.signatures[signature].type_parameters;
        if type_parameters.len() == 0 {
            return signature;
        }
        let key = CachedSignatureKey {
            sig: signature,
            key: signature_key_erased(),
        };
        let mut erased = self.cached_signatures.get(&key);
        if erased.is_nil() {
            let any_type = self.any_type;
            let mapper = new_array_to_single_type_mapper(self, type_parameters, any_type);
            erased = self.instantiate_signature_ex(signature, mapper, true);
            let ok = self.cached_signatures.set(key, erased);
            self.map_set(ok);
        }
        erased
    }

    pub fn get_canonical_signature(&mut self, signature: SignatureId) -> SignatureId {
        if self.signatures[signature].type_parameters.len() == 0 {
            return signature;
        }
        let key = CachedSignatureKey {
            sig: signature,
            key: signature_key_canonical(),
        };
        let mut canonical = self.cached_signatures.get(&key);
        if canonical.is_nil() {
            canonical = self.create_canonical_signature(signature);
            let ok = self.cached_signatures.set(key, canonical);
            self.map_set(ok);
        }
        canonical
    }

    pub fn create_canonical_signature(&mut self, signature: SignatureId) -> SignatureId {
        // Create an instantiation of the signature where each unconstrained type parameter is replaced with its original. When a generic class or interface is instantiated, each generic method in the class or interface is instantiated with a fresh set of cloned type parameters (which we need to handle scenarios where different generations of the same type parameter are in scope). This leads to a lot of new type identities, and potentially a lot of work comparing those identities, so here we create an instantiation that uses the original type identities for all unconstrained type parameters.
        let type_parameters = self.signatures[signature].type_parameters;
        let type_arguments = self.map_list(type_parameters, |c, tp| {
            let target = c.type_target(tp);
            if !target.is_nil() && c.get_constraint_of_type_parameter(target).is_nil() {
                return target;
            }
            tp
        });
        let is_java_script = is_in_js_file(self.ast, self.signatures[signature].declaration);
        self.get_signature_instantiation(signature, type_arguments, is_java_script, List::NIL)
    }

    pub fn get_base_signature(&mut self, signature: SignatureId) -> SignatureId {
        let type_parameters = self.signatures[signature].type_parameters;
        if type_parameters.len() == 0 {
            return signature;
        }
        let key = CachedSignatureKey {
            sig: signature,
            key: signature_key_base(),
        };
        let cached = self.cached_signatures.get(&key);
        if !cached.is_nil() {
            return cached;
        }
        let constraints = self.map_list(type_parameters, |c, tp| {
            let constraint = c.get_constraint_of_type_parameter(tp);
            if !constraint.is_nil() {
                return constraint;
            }
            c.unknown_type
        });
        let base_constraint_mapper = new_type_mapper(self, type_parameters, constraints);
        let mut base_constraints = self.map_list(type_parameters, |c, tp| {
            c.instantiate_type(tp, base_constraint_mapper)
        });
        // Run the immediate constraint mapper N-1 times so non-circular interdependent type parameters resolve to their external dependencies without adding an extra expansion step for self-recursive constraints.
        let mut i = 0;
        while i < type_parameters.len() - 1 {
            base_constraints = self.instantiate_types(base_constraints, base_constraint_mapper);
            i += 1;
        }
        // and then apply a type eraser to remove any remaining circularly dependent type parameters
        let any_type = self.any_type;
        let eraser = new_array_to_single_type_mapper(self, type_parameters, any_type);
        base_constraints = self.instantiate_types(base_constraints, eraser);
        let mapper = new_type_mapper(self, type_parameters, base_constraints);
        let result = self.instantiate_signature_ex(signature, mapper, true);
        let ok = self.cached_signatures.set(key, result);
        self.map_set(ok);
        result
    }

    // Instantiate a generic signature in the context of a non-generic signature (section 3.8.5 in TypeScript spec)
    pub fn instantiate_signature_in_context_of(
        &mut self,
        signature: SignatureId,
        contextual_signature: SignatureId,
        inference_context: InferenceContextId,
        compare_types: TypeComparer,
    ) -> SignatureId {
        let type_parameters = self.get_type_parameters_for_mapper(signature);
        let context = self.new_inference_context(
            type_parameters,
            signature,
            InferenceFlags::NONE,
            compare_types,
        );
        // We clone the inferenceContext to avoid fixing. For example, when the source signature is <T>(x: T) => T[] and the contextual signature is (...args: A) => B, we want to infer the element type of A's constraint (say 'any') for T but leave it possible to later infer '[any]' back to A.
        let rest_type = self.get_effective_rest_type(contextual_signature);
        let mut mapper = TypeMapperId::NIL;
        if !inference_context.is_nil() {
            if !rest_type.is_nil()
                && self.types[rest_type]
                    .flags
                    .intersects(TypeFlags::TYPE_PARAMETER)
            {
                mapper = self.inference_contexts[inference_context].non_fixing_mapper;
            } else {
                mapper = self.inference_contexts[inference_context].mapper;
            }
        }
        let source_signature = if !mapper.is_nil() {
            self.instantiate_signature(contextual_signature, mapper)
        } else {
            contextual_signature
        };
        self.apply_to_parameter_types(source_signature, signature, &mut |c, source, target| {
            // Type parameters from outer context referenced by source type are fixed by instantiation of the source type
            let inferences = c.inference_contexts[context].inferences;
            c.infer_types(inferences, source, target, InferencePriority::NONE, false);
        });
        if inference_context.is_nil() {
            self.apply_to_return_types(
                contextual_signature,
                signature,
                &mut |c, source, target| {
                    let inferences = c.inference_contexts[context].inferences;
                    c.infer_types(
                        inferences,
                        source,
                        target,
                        InferencePriority::RETURN_TYPE,
                        false,
                    );
                },
            );
        }
        let inferred_types = self.get_inferred_types(context);
        let is_java_script =
            is_in_js_file(self.ast, self.signatures[contextual_signature].declaration);
        self.get_signature_instantiation(signature, inferred_types, is_java_script, List::NIL)
    }

    pub fn get_signatures_of_symbol(&mut self, symbol: SymbolId) -> List<'a, SignatureId> {
        if symbol.is_nil() {
            return List::NIL;
        }
        let a = self.ast;
        let declarations = a.sym(symbol).declarations;
        let mut result: Vec<SignatureId> = Vec::new();
        for (i, &decl) in declarations.as_slice().iter().enumerate() {
            if !is_function_like(a, decl) {
                continue;
            }
            // Don't include signature if node is the implementation of an overloaded function. A node is considered an implementation node if it has a body and the previous node is of the same kind and immediately precedes the implementation node (i.e. has the same parent and ends where the implementation starts).
            if i > 0 && !a.body(decl).is_nil() {
                let previous = declarations.at(i - 1);
                if a.parent(decl) == a.parent(previous)
                    && a.kind(decl) == a.kind(previous)
                    && (a.pos(decl) == a.end(previous)
                        || a.flags(previous).intersects(NodeFlags::REPARSED))
                {
                    continue;
                }
            }
            // If this is a function or method declaration, get the signature from the @type tag for the sake of optional parameters. Exclude contextually-typed kinds because we already apply the @type tag to the context, plus applying it here to the initializer would suppress checks that the two are compatible.
            let mut sig = self.get_signature_of_full_signature_type(decl);
            if sig.is_nil() {
                sig = self.get_signature_from_declaration(decl);
            }
            result.push(sig);
        }
        if result.is_empty() {
            return List::NIL;
        }
        self.list_of(&result)
    }

    pub fn get_signature_from_declaration(&mut self, declaration: NodeId) -> SignatureId {
        let a = self.ast;
        let links = self.signature_links.get(declaration);
        if !self.signature_links[links].resolved_signature.is_nil() {
            return self.signature_links[links].resolved_signature;
        }
        let mut parameters: Vec<SymbolId> = Vec::new();
        let mut flags = SignatureFlags::NONE;
        let mut this_parameter = SymbolId::NIL;
        let mut min_argument_count: isize = 0;
        let mut has_this_parameter = false;
        let iife = get_immediately_invoked_function_expression(a, declaration);
        let is_untyped_signature_in_js_file = iife.is_nil()
            && is_in_js_file(a, declaration)
            && (is_function_expression(a, declaration)
                || is_arrow_function(a, declaration)
                || is_method_or_accessor(a, declaration)
                || is_function_declaration(a, declaration)
                || is_constructor_declaration(a, declaration))
            && a.parameters(declaration)
                .as_slice()
                .iter()
                .all(|&param| a.type_node(param).is_nil())
            && self
                .get_contextual_type(declaration, ContextFlags::SIGNATURE)
                .is_nil();
        if is_untyped_signature_in_js_file {
            flags |= SignatureFlags::IS_UNTYPED_SIGNATURE_IN_JS_FILE;
        }
        for (i, &param) in a.parameters(declaration).as_slice().iter().enumerate() {
            let mut param_symbol = a.symbol(param);
            let type_node = a.type_node(param);
            // Include parameter symbol instead of property symbol in the signature
            if !param_symbol.is_nil()
                && a.sym(param_symbol).flags.intersects(SymbolFlags::PROPERTY)
                && !is_binding_pattern(a, a.name(param))
            {
                let resolved_symbol = self.resolve_name(
                    param,
                    a.sym(param_symbol).name,
                    SymbolFlags::VALUE,
                    MessageId::NIL,
                    false,
                    false,
                );
                param_symbol = resolved_symbol;
            }
            if i == 0 && a.sym(param_symbol).name == INTERNAL_SYMBOL_NAME_THIS {
                has_this_parameter = true;
                this_parameter = a.symbol(param);
            } else {
                parameters.push(param_symbol);
            }
            if !type_node.is_nil() && a.kind(type_node) == Kind::LiteralType {
                flags |= SignatureFlags::HAS_LITERAL_TYPES;
            }
            // Record a new minimum argument count if this is not an optional parameter
            let is_optional_parameter = is_optional_declaration(a, param)
                || !a.initializer(param).is_nil()
                || is_rest_parameter(a, param)
                || !iife.is_nil()
                    && parameters.len() > a.arguments(iife).as_slice().len()
                    && type_node.is_nil();
            if !is_optional_parameter {
                min_argument_count = parameters.len() as isize;
            }
        }
        // If only one accessor includes a this-type annotation, the other behaves as if it had the same type annotation
        if (is_get_accessor_declaration(a, declaration)
            || is_set_accessor_declaration(a, declaration))
            && self.has_bindable_name(declaration)
            && (!has_this_parameter || this_parameter.is_nil())
        {
            let other_kind = if is_get_accessor_declaration(a, declaration) {
                Kind::SetAccessor
            } else {
                Kind::GetAccessor
            };
            let symbol = self.get_symbol_of_declaration(declaration);
            let other = get_declaration_of_kind(a, symbol, other_kind);
            if !other.is_nil() {
                this_parameter = self.get_annotated_accessor_this_parameter(other);
            }
        }
        let mut class_type = TypeId::NIL;
        if is_constructor_declaration(a, declaration) {
            let class_symbol = self.get_merged_symbol(a.symbol(a.parent(declaration)));
            class_type = self.get_declared_type_of_class_or_interface(class_symbol);
        }
        let type_parameters = if !class_type.is_nil() {
            self.as_interface_type(class_type).local_type_parameters()
        } else {
            self.get_type_parameters_from_declaration(declaration)
        };
        if has_rest_parameter(a, declaration) {
            flags |= SignatureFlags::HAS_REST_PARAMETER;
        }
        if is_constructor_type_node(a, declaration)
            || is_constructor_declaration(a, declaration)
            || is_construct_signature_declaration(a, declaration)
        {
            flags |= SignatureFlags::CONSTRUCT;
        }
        if is_constructor_type_node(a, declaration)
            && has_syntactic_modifier(a, declaration, ModifierFlags::ABSTRACT)
            || is_constructor_declaration(a, declaration)
                && has_syntactic_modifier(a, a.parent(declaration), ModifierFlags::ABSTRACT)
        {
            flags |= SignatureFlags::ABSTRACT;
        }
        let parameters = if parameters.is_empty() {
            List::NIL
        } else {
            self.list_of(&parameters)
        };
        let signature = self.new_signature(
            flags,
            declaration,
            type_parameters,
            this_parameter,
            parameters,
            TypeId::NIL,
            TypePredicateId::NIL,
            min_argument_count,
        );
        self.signature_links[links].resolved_signature = signature;
        self.signature_links[links].resolved_signature
    }

    pub fn get_type_parameters_from_declaration(
        &mut self,
        declaration: NodeId,
    ) -> List<'a, TypeId> {
        let a = self.ast;
        let sig = self.get_signature_of_full_signature_type(declaration);
        if !sig.is_nil() {
            return self.signatures[sig].type_parameters;
        }
        let mut result: Vec<TypeId> = Vec::new();
        for &node in a.type_parameters(declaration).as_slice() {
            let type_parameter = self.get_declared_type_of_type_parameter(a.symbol(node));
            result = append_if_unique(result, type_parameter);
        }
        if result.is_empty() {
            return List::NIL;
        }
        self.list_of(&result)
    }

    pub fn get_annotated_accessor_this_parameter(&self, accessor: NodeId) -> SymbolId {
        let parameter = self.get_accessor_this_parameter(accessor);
        if !parameter.is_nil() {
            return self.ast.symbol(parameter);
        }
        SymbolId::NIL
    }

    pub fn get_accessor_this_parameter(&self, accessor: NodeId) -> NodeId {
        let a = self.ast;
        let expected_count = if is_get_accessor_declaration(a, accessor) {
            1
        } else {
            2
        };
        if a.parameters(accessor).len() == expected_count {
            return get_this_parameter(a, accessor);
        }
        NodeId::NIL
    }

    // Indicates whether a declaration has an early-bound name or a dynamic name that can be late-bound.
    pub fn has_bindable_name(&mut self, node: NodeId) -> bool {
        !has_dynamic_name(self.ast, node) || self.has_late_bindable_name(node)
    }

    // Indicates whether a declaration has a late-bindable dynamic name.
    pub fn has_late_bindable_name(&mut self, node: NodeId) -> bool {
        let name = get_name_of_declaration(self.ast, node);
        !name.is_nil() && self.is_late_bindable_name(name)
    }

    // Indicates whether a declaration name is definitely late-bindable. A declaration name is only late-bindable if: it is a `ComputedPropertyName`; its expression is an `Identifier` or either a `PropertyAccessExpression` an `ElementAccessExpression` consisting only of these same three types of nodes; the type of its expression is a string or numeric literal type, or is a `unique symbol` type.
    pub fn is_late_bindable_name(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        if !is_late_bindable_ast(a, node) {
            return false;
        }
        if is_computed_property_name(a, node) {
            let name_type = self.check_computed_property_name(node);
            return is_type_usable_as_property_name(self, name_type);
        }
        let argument_type =
            self.check_expression_cached(a.as_element_access_expression(node).argument_expression);
        is_type_usable_as_property_name(self, argument_type)
    }

    pub fn has_late_bindable_index_signature(&mut self, node: NodeId) -> bool {
        let name = get_name_of_declaration(self.ast, node);
        !name.is_nil() && self.is_late_bindable_index_signature(name)
    }

    pub fn is_late_bindable_index_signature(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        if !is_late_bindable_ast(a, node) {
            return false;
        }
        if is_computed_property_name(a, node) {
            let name_type = self.check_computed_property_name(node);
            return self.is_type_usable_as_index_signature_declaration(name_type);
        }
        let argument_type =
            self.check_expression_cached(a.as_element_access_expression(node).argument_expression);
        self.is_type_usable_as_index_signature_declaration(argument_type)
    }

    pub fn is_type_usable_as_index_signature_declaration(&mut self, t: TypeId) -> bool {
        self.is_type_assignable_to(t, self.string_number_symbol_type)
    }
}

pub fn is_late_bindable_ast(a: Ast<'_>, node: NodeId) -> bool {
    let mut expr = NodeId::NIL;
    if is_computed_property_name(a, node) {
        expr = a.expression(node);
    } else if is_element_access_expression(a, node) {
        expr = a.as_element_access_expression(node).argument_expression;
    }
    !expr.is_nil() && is_entity_name_expression(a, expr)
}
