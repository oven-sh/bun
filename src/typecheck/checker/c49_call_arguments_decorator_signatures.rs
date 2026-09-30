// checker.go:30164-30672 (layer E-DECOR): the functions of 30265-30672: the synthetic arguments and call signatures of decorators, decorator context types and synthetic function types.
use crate::ast::{
    Factory, Kind, NodeFactory, NodeId, NodeListId, SymbolId, get_this_parameter,
    has_accessor_modifier, has_static_modifier, is_auto_accessor_property_declaration,
    is_class_like, is_constructor_declaration, is_get_accessor_declaration, is_method_declaration,
    is_private_identifier, is_property_declaration, is_set_accessor_declaration, is_static,
};
use crate::checker::{
    CachedTypeKey, CachedTypeKind, Checker, SignatureFlags, SignatureId, TypeFlags, TypeId,
    TypePredicateId,
};
use crate::core::List;
use crate::jsnum::Number;

impl<'a> Checker<'a> {
    // Returns the synthetic argument list for a decorator invocation.
    pub fn get_effective_decorator_arguments(&mut self, node: NodeId) -> Vec<NodeId> {
        let expr = self.ast.expression(node);
        let signature = self.get_decorator_call_signature(node);
        if !signature.is_nil() {
            let parameters = self.signatures[signature].parameters;
            let mut args: Vec<NodeId> = Vec::with_capacity(parameters.as_slice().len());
            for &param in parameters.as_slice() {
                let param_type = self.get_type_of_symbol(param);
                args.push(self.create_synthetic_expression(expr, param_type, false, NodeId::NIL));
            }
            return args;
        }
        let _: () = self.fail("Decorator signature not found");
        Vec::new()
    }

    pub fn get_decorator_call_signature(&mut self, decorator: NodeId) -> SignatureId {
        if self.legacy_decorators {
            return self.get_legacy_decorator_call_signature(decorator);
        }
        self.get_es_decorator_call_signature(decorator)
    }

    pub fn get_legacy_decorator_call_signature(&mut self, decorator: NodeId) -> SignatureId {
        let a = self.ast;
        let node = a.parent(decorator);
        let links = self.signature_links.get(node);
        if self.signature_links[links].decorator_signature.is_nil() {
            self.signature_links[links].decorator_signature = self.any_signature;
            match a.kind(node) {
                Kind::ClassDeclaration | Kind::ClassExpression => {
                    // For a class decorator, the `target` is the type of the class (e.g. the "static" or "constructor" side of the class).
                    let class_symbol = self.get_symbol_of_declaration(node);
                    let target_type = self.get_type_of_symbol(class_symbol);
                    let target_param = self.new_parameter(b"target", target_type);
                    let return_type =
                        self.get_union_type(List::from_slice(&[target_type, self.void_type]));
                    let parameters = self.list_of(&[target_param]);
                    let signature =
                        self.new_call_signature(List::NIL, SymbolId::NIL, parameters, return_type);
                    self.signature_links[links].decorator_signature = signature;
                }
                Kind::Parameter => 'parameter: {
                    let parent = a.parent(node);
                    if !is_constructor_declaration(a, parent)
                        && !(is_method_declaration(a, parent)
                            || is_set_accessor_declaration(a, parent)
                                && is_class_like(a, a.parent(parent)))
                    {
                        break 'parameter;
                    }
                    if get_this_parameter(a, parent) == node {
                        break 'parameter;
                    }
                    let position = a
                        .parameters(parent)
                        .as_slice()
                        .iter()
                        .position(|&parameter| parameter == node)
                        .map_or(-1, |position| position as isize);
                    let index = position
                        - if !get_this_parameter(a, parent).is_nil() {
                            1
                        } else {
                            0
                        };
                    self.assert(index >= 0, "index >= 0");
                    // A parameter declaration decorator will have three arguments (see `ParameterDecorator` in core.d.ts).
                    let (target_type, key_type) = if is_constructor_declaration(a, parent) {
                        let class_symbol = self.get_symbol_of_declaration(a.parent(parent));
                        (self.get_type_of_symbol(class_symbol), self.undefined_type)
                    } else {
                        let target_type = self.get_parent_type_of_class_element(parent);
                        let key_type = self.get_class_element_property_key_type(parent);
                        (target_type, key_type)
                    };
                    let index_type = self.get_number_literal_type(Number(index as f64));
                    let target_param = self.new_parameter(b"target", target_type);
                    let key_param = self.new_parameter(b"propertyKey", key_type);
                    let index_param = self.new_parameter(b"parameterIndex", index_type);
                    let parameters = self.list_of(&[target_param, key_param, index_param]);
                    let signature = self.new_call_signature(
                        List::NIL,
                        SymbolId::NIL,
                        parameters,
                        self.void_type,
                    );
                    self.signature_links[links].decorator_signature = signature;
                }
                Kind::MethodDeclaration
                | Kind::GetAccessor
                | Kind::SetAccessor
                | Kind::PropertyDeclaration => 'member: {
                    if !is_class_like(a, a.parent(node)) {
                        break 'member;
                    }
                    // A method or accessor declaration decorator will have either two or three arguments (see `PropertyDecorator` and `MethodDecorator` in core.d.ts).
                    let target_type = self.get_parent_type_of_class_element(node);
                    let target_param = self.new_parameter(b"target", target_type);
                    let key_type = self.get_class_element_property_key_type(node);
                    let key_param = self.new_parameter(b"propertyKey", key_type);
                    let mut return_type = self.void_type;
                    if !is_property_declaration(a, node) {
                        let node_type = self.get_type_of_node(node);
                        return_type = self.new_typed_property_descriptor_type(node_type);
                    }
                    let has_prop_desc =
                        !is_property_declaration(a, node) || has_accessor_modifier(a, node);
                    if has_prop_desc {
                        let node_type = self.get_type_of_node(node);
                        let descriptor_type = self.new_typed_property_descriptor_type(node_type);
                        let descriptor_param = self.new_parameter(b"descriptor", descriptor_type);
                        let signature_return_type =
                            self.get_union_type(List::from_slice(&[return_type, self.void_type]));
                        let parameters = self.list_of(&[target_param, key_param, descriptor_param]);
                        let signature = self.new_call_signature(
                            List::NIL,
                            SymbolId::NIL,
                            parameters,
                            signature_return_type,
                        );
                        self.signature_links[links].decorator_signature = signature;
                    } else {
                        let signature_return_type =
                            self.get_union_type(List::from_slice(&[return_type, self.void_type]));
                        let parameters = self.list_of(&[target_param, key_param]);
                        let signature = self.new_call_signature(
                            List::NIL,
                            SymbolId::NIL,
                            parameters,
                            signature_return_type,
                        );
                        self.signature_links[links].decorator_signature = signature;
                    }
                }
                _ => {}
            }
        }
        let decorator_signature = self.signature_links[links].decorator_signature;
        if decorator_signature == self.any_signature {
            return SignatureId::NIL;
        }
        decorator_signature
    }

    pub fn get_es_decorator_call_signature(&mut self, decorator: NodeId) -> SignatureId {
        // We are considering a future change that would allow the type of a decorator to affect the type of the class and its members, such as a `@Stringify` decorator changing the type of a `number` field to `string`, or a `@Callable` decorator adding a call signature to a `class`. The type arguments for the various context types may eventually change to reflect such mutations. In some cases we describe such potential mutations as coming from a "prior decorator application". It is important to note that, while decorators are *evaluated* left to right, they are *applied* right to left to preserve f ৹ g -> f(g(x)) application order. In these cases, a "prior" decorator usually means the next decorator following this one in document order. The "original type" of a class or member is the type it was declared as, or the type we infer from initializers, before _any_ decorators are applied. The type of a class or member that is a result of a prior decorator application represents the "current type", i.e., the type for the declaration at the time the decorator is _applied_. The type of a class or member that is the result of the application of *all* relevant decorators is the "final type". Any decorator that allows mutation or replacement will also refer to an "input type" and an "output type". The "input type" corresponds to the "current type" of the declaration, while the "output type" will become either the "input type/current type" for a subsequent decorator application, or the "final type" for the decorated declaration. It is important to understand decorator application order as it relates to how the "current", "input", "output", and "final" types will be determined: @E2 @E1 class SomeClass { @A2 @A1 static f() {} @B2 @B1 g() {} @C2 @C1 static x; @D2 @D1 y; } Per [the specification][1], decorators are applied in the following order: 1. For each static method (incl. get/set methods and `accessor` fields), in document order: a. Apply each decorator for that method, in reverse order (`A1`, `A2`). 2. For each instance method (incl. get/set methods and `accessor` fields), in document order: a. Apply each decorator for that method, in reverse order (`B1`, `B2`). 3. For each static field (excl. auto-accessors), in document order: a. Apply each decorator for that field, in reverse order (`C1`, `C2`). 4. For each instance field (excl. auto-accessors), in document order: a. Apply each decorator for that field, in reverse order (`D1`, `D2`). 5. Apply each decorator for the class, in reverse order (`E1`, `E2`). As a result, "current" types at each decorator application are as follows: For `A1`, the "current" types of the class and method are their "original" types. For `A2`, the "current type" of the method is the "output type" of `A1`, and the "current type" of the class is the type of `SomeClass` where `f` is the "output type" of `A1`. This becomes the "final type" of `f`. For `B1`, the "current type" of the method is its "original type", and the "current type" of the class is the type of `SomeClass` where `f` now has its "final type". etc. [1]: https://arai-a.github.io/ecma262-compare/?pr=2417&id=sec-runtime-semantics-classdefinitionevaluation This seems complicated at first glance, but is not unlike our existing inference for functions: declare function pipe<Original, A1, A2, B1, B2, C1, C2, D1, D2, E1, E2>(original: Original, a1: (input: Original, context: Context<E2>) => A1, a2: (input: A1, context: Context<E2>) => A2, b1: (input: A2, context: Context<E2>) => B1, b2: (input: B1, context: Context<E2>) => B2, c1: (input: B2, context: Context<E2>) => C1, c2: (input: C1, context: Context<E2>) => C2, d1: (input: C2, context: Context<E2>) => D1, d2: (input: D1, context: Context<E2>) => D2, e1: (input: D2, context: Context<E2>) => E1, e2: (input: E1, context: Context<E2>) => E2): E2;
        let a = self.ast;

        // When a decorator is applied, it is passed two arguments: "target", which is a value representing the thing being decorated (constructors for classes, functions for methods/accessors, `undefined` for fields, and a `{ get, set }` object for auto-accessors), and "context", which is an object that provides reflection information about the decorated element, as well as the ability to add additional "extra" initializers. In most cases, the "target" argument corresponds to the "input type" in some way, and the return value similarly corresponds to the "output type" (though if the "output type" is `void` or `undefined` then the "output type" is the "input type").
        let node = a.parent(decorator);
        let links = self.signature_links.get(node);
        if self.signature_links[links].decorator_signature.is_nil() {
            self.signature_links[links].decorator_signature = self.any_signature;
            match a.kind(node) {
                Kind::ClassDeclaration | Kind::ClassExpression => {
                    // Class decorators have a `context` of `ClassDecoratorContext<Class>`, where the `Class` type argument will be the "final type" of the class after all decorators are applied.
                    let class_symbol = self.get_symbol_of_declaration(node);
                    let target_type = self.get_type_of_symbol(class_symbol);
                    let context_type = self.new_class_decorator_context_type(target_type);
                    let signature = self.new_es_decorator_call_signature(
                        target_type,
                        context_type,
                        target_type,
                    );
                    self.signature_links[links].decorator_signature = signature;
                }
                Kind::MethodDeclaration | Kind::GetAccessor | Kind::SetAccessor => 'member: {
                    if !is_class_like(a, a.parent(node)) {
                        break 'member;
                    }
                    // Method decorators have a `context` of `ClassMethodDecoratorContext<This, Value>`, where the `Value` type argument corresponds to the "final type" of the method. Getter decorators have a `context` of `ClassGetterDecoratorContext<This, Value>`, where the `Value` type argument corresponds to the "final type" of the value returned by the getter. Setter decorators have a `context` of `ClassSetterDecoratorContext<This, Value>`, where the `Value` type argument corresponds to the "final type" of the parameter of the setter. In all three cases, the `This` type argument is the "final type" of either the class or instance, depending on whether the member was `static`.
                    let value_type = if is_method_declaration(a, node) {
                        let signature = self.get_signature_from_declaration(node);
                        self.get_or_create_type_from_signature(signature)
                    } else {
                        self.get_type_of_node(node)
                    };
                    let class_symbol = self.get_symbol_of_declaration(a.parent(node));
                    let this_type = if has_static_modifier(a, node) {
                        self.get_type_of_symbol(class_symbol)
                    } else {
                        self.get_declared_type_of_class_or_interface(class_symbol)
                    };
                    // We wrap the "input type", if necessary, to match the decoration target. For getters this is something like `() => inputType`, for setters it's `(value: inputType) => void` and for methods it is just the input type.
                    let target_type = if is_get_accessor_declaration(a, node) {
                        self.new_getter_function_type(value_type)
                    } else if is_set_accessor_declaration(a, node) {
                        self.new_setter_function_type(value_type)
                    } else {
                        value_type
                    };
                    let context_type = self.new_class_member_decorator_context_type_for_node(
                        node, this_type, value_type,
                    );
                    let signature = self.new_es_decorator_call_signature(
                        target_type,
                        context_type,
                        target_type,
                    );
                    self.signature_links[links].decorator_signature = signature;
                }
                Kind::PropertyDeclaration => 'property: {
                    if !is_class_like(a, a.parent(node)) {
                        break 'property;
                    }
                    // Field decorators have a `context` of `ClassFieldDecoratorContext<This, Value>` and auto-accessor decorators have a `context` of `ClassAccessorDecoratorContext<This, Value>. In both cases, the `This` type argument is the "final type" of either the class or instance, depending on whether the member was `static`, and the `Value` type argument corresponds to the "final type" of the value stored in the field.
                    let value_type = self.get_type_of_node(node);
                    let class_symbol = self.get_symbol_of_declaration(a.parent(node));
                    let this_type = if has_static_modifier(a, node) {
                        self.get_type_of_symbol(class_symbol)
                    } else {
                        self.get_declared_type_of_class_or_interface(class_symbol)
                    };
                    // The `target` of an auto-accessor decorator is a `{ get, set }` object, representing the runtime-generated getter and setter that are added to the class/prototype. The `target` of a regular field decorator is always `undefined` as it isn't installed until it is initialized.
                    let target_type = if has_accessor_modifier(a, node) {
                        self.new_class_accessor_decorator_target_type(this_type, value_type)
                    } else {
                        self.undefined_type
                    };
                    // We wrap the "output type" depending on the declaration. For auto-accessors, we wrap the "output type" in a `ClassAccessorDecoratorResult<This, In, Out>` type, which allows for mutation of the runtime-generated getter and setter, as well as the injection of an initializer mutator. For regular fields, we wrap the "output type" in an initializer mutator.
                    let return_type = if has_accessor_modifier(a, node) {
                        self.new_class_accessor_decorator_result_type(this_type, value_type)
                    } else {
                        self.new_class_field_decorator_initializer_mutator_type(
                            this_type, value_type,
                        )
                    };
                    let context_type = self.new_class_member_decorator_context_type_for_node(
                        node, this_type, value_type,
                    );
                    let signature = self.new_es_decorator_call_signature(
                        target_type,
                        context_type,
                        return_type,
                    );
                    self.signature_links[links].decorator_signature = signature;
                }
                _ => {}
            }
        }
        let decorator_signature = self.signature_links[links].decorator_signature;
        if decorator_signature == self.any_signature {
            return SignatureId::NIL;
        }
        decorator_signature
    }

    pub fn new_class_decorator_context_type(&mut self, class_type: TypeId) -> TypeId {
        let target = self.get_global_class_decorator_context_type();
        let type_arguments = self.list_of(&[class_type]);
        self.try_create_type_reference(target, type_arguments)
    }

    pub fn new_class_method_decorator_context_type(
        &mut self,
        class_type: TypeId,
        value_type: TypeId,
    ) -> TypeId {
        let target = self.get_global_class_method_decorator_context_type();
        let type_arguments = self.list_of(&[class_type, value_type]);
        self.try_create_type_reference(target, type_arguments)
    }

    pub fn new_class_getter_decorator_context_type(
        &mut self,
        class_type: TypeId,
        value_type: TypeId,
    ) -> TypeId {
        let target = self.get_global_class_getter_decorator_context_type();
        let type_arguments = self.list_of(&[class_type, value_type]);
        self.try_create_type_reference(target, type_arguments)
    }

    pub fn new_class_setter_decorator_context_type(
        &mut self,
        class_type: TypeId,
        value_type: TypeId,
    ) -> TypeId {
        let target = self.get_global_class_setter_decorator_context_type();
        let type_arguments = self.list_of(&[class_type, value_type]);
        self.try_create_type_reference(target, type_arguments)
    }

    pub fn new_class_accessor_decorator_context_type(
        &mut self,
        this_type: TypeId,
        value_type: TypeId,
    ) -> TypeId {
        let target = self.get_global_class_accessor_decorator_context_type();
        let type_arguments = self.list_of(&[this_type, value_type]);
        self.try_create_type_reference(target, type_arguments)
    }

    pub fn new_class_field_decorator_context_type(
        &mut self,
        this_type: TypeId,
        value_type: TypeId,
    ) -> TypeId {
        let target = self.get_global_class_field_decorator_context_type();
        let type_arguments = self.list_of(&[this_type, value_type]);
        self.try_create_type_reference(target, type_arguments)
    }

    // Gets a type like `{ name: "foo", private: false, static: true }` that is used to provided member-specific details that will be intersected with a decorator context type.
    pub fn get_class_member_decorator_context_override_type(
        &mut self,
        name_type: TypeId,
        is_private: bool,
        is_static: bool,
    ) -> TypeId {
        let a = self.ast;
        let kind = if is_private {
            if is_static {
                CachedTypeKind::DECORATOR_CONTEXT_PRIVATE_STATIC
            } else {
                CachedTypeKind::DECORATOR_CONTEXT_PRIVATE
            }
        } else if is_static {
            CachedTypeKind::DECORATOR_CONTEXT_STATIC
        } else {
            CachedTypeKind::DECORATOR_CONTEXT
        };
        let key = CachedTypeKey {
            kind,
            type_id: name_type,
        };
        let override_type = self.cached_types.get(&key);
        if !override_type.is_nil() {
            return override_type;
        }
        let members = a.new_table();
        let name_property = self.new_property(b"name", name_type);
        a.table_set(members, b"name", name_property);
        let private_property = self.new_property(
            b"private",
            if is_private {
                self.true_type
            } else {
                self.false_type
            },
        );
        a.table_set(members, b"private", private_property);
        let static_property = self.new_property(
            b"static",
            if is_static {
                self.true_type
            } else {
                self.false_type
            },
        );
        a.table_set(members, b"static", static_property);
        let override_type =
            self.new_anonymous_type(SymbolId::NIL, members, List::NIL, List::NIL, List::NIL);
        let ok = self.cached_types.set(key, override_type);
        self.map_set(ok);
        override_type
    }

    pub fn new_class_member_decorator_context_type_for_node(
        &mut self,
        node: NodeId,
        this_type: TypeId,
        value_type: TypeId,
    ) -> TypeId {
        let a = self.ast;
        let is_static = has_static_modifier(a, node);
        let is_private = is_private_identifier(a, a.name(node));
        let name_type = if is_private {
            self.get_string_literal_type(a.text(a.name(node)))
        } else {
            self.get_literal_type_from_property_name(a.name(node))
        };
        let context_type = if is_method_declaration(a, node) {
            self.new_class_method_decorator_context_type(this_type, value_type)
        } else if is_get_accessor_declaration(a, node) {
            self.new_class_getter_decorator_context_type(this_type, value_type)
        } else if is_set_accessor_declaration(a, node) {
            self.new_class_setter_decorator_context_type(this_type, value_type)
        } else if is_auto_accessor_property_declaration(a, node) {
            self.new_class_accessor_decorator_context_type(this_type, value_type)
        } else if is_property_declaration(a, node) {
            self.new_class_field_decorator_context_type(this_type, value_type)
        } else {
            return self.fail("Unhandled case in createClassMemberDecoratorContextTypeForNode");
        };
        let override_type =
            self.get_class_member_decorator_context_override_type(name_type, is_private, is_static);
        self.get_intersection_type(List::from_slice(&[context_type, override_type]))
    }

    pub fn new_class_accessor_decorator_target_type(
        &mut self,
        this_type: TypeId,
        value_type: TypeId,
    ) -> TypeId {
        let target = self.get_global_class_accessor_decorator_target_type();
        let type_arguments = self.list_of(&[this_type, value_type]);
        self.try_create_type_reference(target, type_arguments)
    }

    pub fn new_class_accessor_decorator_result_type(
        &mut self,
        this_type: TypeId,
        value_type: TypeId,
    ) -> TypeId {
        let target = self.get_global_class_accessor_decorator_result_type();
        let type_arguments = self.list_of(&[this_type, value_type]);
        self.try_create_type_reference(target, type_arguments)
    }

    pub fn new_class_field_decorator_initializer_mutator_type(
        &mut self,
        this_type: TypeId,
        value_type: TypeId,
    ) -> TypeId {
        let this_param = self.new_parameter(b"this", this_type);
        let value_param = self.new_parameter(b"value", value_type);
        let parameters = self.list_of(&[value_param]);
        self.new_function_type(List::NIL, this_param, parameters, value_type)
    }

    // Creates a call signature for an ES Decorator. This method is used by the semantics of `getESDecoratorCallSignature`, which you should probably be using instead.
    pub fn new_es_decorator_call_signature(
        &mut self,
        target_type: TypeId,
        context_type: TypeId,
        non_optional_return_type: TypeId,
    ) -> SignatureId {
        let target_param = self.new_parameter(b"target", target_type);
        let context_param = self.new_parameter(b"context", context_type);
        let return_type = self.get_union_type(List::from_slice(&[
            non_optional_return_type,
            self.void_type,
        ]));
        let parameters = self.list_of(&[target_param, context_param]);
        self.new_call_signature(List::NIL, SymbolId::NIL, parameters, return_type)
    }

    // Creates a synthetic `FunctionType`
    pub fn new_function_type(
        &mut self,
        type_parameters: List<'a, TypeId>,
        this_parameter: SymbolId,
        parameters: List<'a, SymbolId>,
        return_type: TypeId,
    ) -> TypeId {
        let signature =
            self.new_call_signature(type_parameters, this_parameter, parameters, return_type);
        self.get_or_create_type_from_signature(signature)
    }

    pub fn new_getter_function_type(&mut self, t: TypeId) -> TypeId {
        self.new_function_type(List::NIL, SymbolId::NIL, List::NIL, t)
    }

    pub fn new_setter_function_type(&mut self, t: TypeId) -> TypeId {
        let value_param = self.new_parameter(b"value", t);
        let parameters = self.list_of(&[value_param]);
        self.new_function_type(List::NIL, SymbolId::NIL, parameters, self.void_type)
    }

    // Creates a synthetic `Signature` corresponding to a call signature.
    pub fn new_call_signature(
        &mut self,
        type_parameters: List<'a, TypeId>,
        this_parameter: SymbolId,
        parameters: List<'a, SymbolId>,
        return_type: TypeId,
    ) -> SignatureId {
        let mut factory = Factory::new(self.ast);
        let any_keyword = factory.new_keyword_type_node(Kind::AnyKeyword);
        let decl = factory.new_function_type_node(NodeListId::NIL, NodeListId::NIL, any_keyword);
        self.new_signature(
            SignatureFlags::NONE,
            decl,
            type_parameters,
            this_parameter,
            parameters,
            return_type,
            TypePredicateId::NIL,
            parameters.len(),
        )
    }

    pub fn new_typed_property_descriptor_type(&mut self, property_type: TypeId) -> TypeId {
        let target = self.get_global_typed_property_descriptor_type();
        let type_arguments = self.list_of(&[property_type]);
        self.create_type_from_generic_global_type(target, type_arguments)
    }

    pub fn get_parent_type_of_class_element(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        let class_symbol = self.get_symbol_of_node(a.parent(node));
        if is_static(a, node) {
            return self.get_type_of_symbol(class_symbol);
        }
        self.get_declared_type_of_symbol(class_symbol)
    }

    pub fn get_class_element_property_key_type(&mut self, element: NodeId) -> TypeId {
        let a = self.ast;
        let name = a.name(element);
        match a.kind(name) {
            Kind::Identifier | Kind::NumericLiteral | Kind::StringLiteral => {
                self.get_string_literal_type(a.text(name))
            }
            Kind::ComputedPropertyName => {
                let name_type = self.check_computed_property_name(name);
                if self.is_type_assignable_to_kind(name_type, TypeFlags::ES_SYMBOL_LIKE) {
                    return name_type;
                }
                self.string_type
            }
            _ => self.error_type,
        }
    }
}
