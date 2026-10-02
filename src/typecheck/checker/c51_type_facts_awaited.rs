// checker.go:31097-31702 (layers E-FACTS, E-AWAIT, K-PRED, K-SUBST): the functions of 31097-31591, 31607-31612 and 31694-31702: type facts, awaited types, the target of a reference and the type variable behind substitution types.
use crate::ast::{Arg, DiagnosticId, NodeId};
use crate::checker::{
    CachedTypeKey, CachedTypeKind, Checker, ObjectFlags, SignatureKind, TypeAliasId, TypeFacts,
    TypeFlags, TypeId, get_big_int_literal_value, get_number_literal_value,
    get_string_literal_value, is_type_any, some_type,
};
use crate::core::List;
use crate::diagnostics::{self, MessageId};
use crate::jsnum::{Number, PseudoBigInt};

impl<'a> Checker<'a> {
    pub fn get_type_facts(&mut self, t: TypeId, mask: TypeFacts) -> TypeFacts {
        self.get_type_facts_worker(t, mask) & mask
    }

    pub fn has_type_facts(&mut self, t: TypeId, mask: TypeFacts) -> bool {
        self.get_type_facts(t, mask) != TypeFacts::NONE
    }

    pub fn get_type_facts_worker(&mut self, t: TypeId, caller_only_needs: TypeFacts) -> TypeFacts {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let mut t = t;
        if self.types[t]
            .flags
            .intersects(TypeFlags::INTERSECTION | TypeFlags::INSTANTIABLE)
        {
            t = self.get_base_constraint_of_type(t);
            if t.is_nil() {
                t = self.unknown_type;
            }
        }
        let flags = self.types[t].flags;
        if flags.intersects(TypeFlags::STRING | TypeFlags::STRING_MAPPING) {
            if self.strict_null_checks {
                return TypeFacts::STRING_STRICT_FACTS;
            }
            return TypeFacts::STRING_FACTS;
        }
        if flags.intersects(TypeFlags::STRING_LITERAL | TypeFlags::TEMPLATE_LITERAL) {
            let is_empty = flags.intersects(TypeFlags::STRING_LITERAL)
                && get_string_literal_value(self, t).is_empty();
            if self.strict_null_checks {
                if is_empty {
                    return TypeFacts::EMPTY_STRING_STRICT_FACTS;
                }
                return TypeFacts::NON_EMPTY_STRING_STRICT_FACTS;
            }
            if is_empty {
                return TypeFacts::EMPTY_STRING_FACTS;
            }
            return TypeFacts::NON_EMPTY_STRING_FACTS;
        }
        if flags.intersects(TypeFlags::NUMBER | TypeFlags::ENUM) {
            if self.strict_null_checks {
                return TypeFacts::NUMBER_STRICT_FACTS;
            }
            return TypeFacts::NUMBER_FACTS;
        }
        if flags.intersects(TypeFlags::NUMBER_LITERAL) {
            let is_zero = get_number_literal_value(self, t) == Number(0.0);
            if self.strict_null_checks {
                if is_zero {
                    return TypeFacts::ZERO_NUMBER_STRICT_FACTS;
                }
                return TypeFacts::NON_ZERO_NUMBER_STRICT_FACTS;
            }
            if is_zero {
                return TypeFacts::ZERO_NUMBER_FACTS;
            }
            return TypeFacts::NON_ZERO_NUMBER_FACTS;
        }
        if flags.intersects(TypeFlags::BIG_INT) {
            if self.strict_null_checks {
                return TypeFacts::BIG_INT_STRICT_FACTS;
            }
            return TypeFacts::BIG_INT_FACTS;
        }
        if flags.intersects(TypeFlags::BIG_INT_LITERAL) {
            let is_zero = is_zero_big_int(self, t);
            if self.strict_null_checks {
                if is_zero {
                    return TypeFacts::ZERO_BIG_INT_STRICT_FACTS;
                }
                return TypeFacts::NON_ZERO_BIG_INT_STRICT_FACTS;
            }
            if is_zero {
                return TypeFacts::ZERO_BIG_INT_FACTS;
            }
            return TypeFacts::NON_ZERO_BIG_INT_FACTS;
        }
        if flags.intersects(TypeFlags::BOOLEAN) {
            if self.strict_null_checks {
                return TypeFacts::BOOLEAN_STRICT_FACTS;
            }
            return TypeFacts::BOOLEAN_FACTS;
        }
        if flags.intersects(TypeFlags::BOOLEAN_LIKE) {
            let is_false = t == self.false_type || t == self.regular_false_type;
            if self.strict_null_checks {
                if is_false {
                    return TypeFacts::FALSE_STRICT_FACTS;
                }
                return TypeFacts::TRUE_STRICT_FACTS;
            }
            if is_false {
                return TypeFacts::FALSE_FACTS;
            }
            return TypeFacts::TRUE_FACTS;
        }
        if flags.intersects(TypeFlags::OBJECT) {
            let possible_facts = if self.strict_null_checks {
                TypeFacts::EMPTY_OBJECT_STRICT_FACTS
                    | TypeFacts::FUNCTION_STRICT_FACTS
                    | TypeFacts::OBJECT_STRICT_FACTS
            } else {
                TypeFacts::EMPTY_OBJECT_FACTS | TypeFacts::FUNCTION_FACTS | TypeFacts::OBJECT_FACTS
            };
            if !caller_only_needs.intersects(possible_facts) {
                // If the caller doesn't care about any of the facts that we could possibly produce, return zero so we can skip resolving members.
                return TypeFacts::NONE;
            }
            if self.types[t]
                .object_flags
                .intersects(ObjectFlags::ANONYMOUS)
                && self.is_empty_object_type(t)
            {
                if self.strict_null_checks {
                    return TypeFacts::EMPTY_OBJECT_STRICT_FACTS;
                }
                return TypeFacts::EMPTY_OBJECT_FACTS;
            }
            if self.is_function_object_type(t) {
                if self.strict_null_checks {
                    return TypeFacts::FUNCTION_STRICT_FACTS;
                }
                return TypeFacts::FUNCTION_FACTS;
            }
            if self.strict_null_checks {
                return TypeFacts::OBJECT_STRICT_FACTS;
            }
            return TypeFacts::OBJECT_FACTS;
        }
        if flags.intersects(TypeFlags::VOID) {
            return TypeFacts::VOID_FACTS;
        }
        if flags.intersects(TypeFlags::UNDEFINED) {
            return TypeFacts::UNDEFINED_FACTS;
        }
        if flags.intersects(TypeFlags::NULL) {
            return TypeFacts::NULL_FACTS;
        }
        if flags.intersects(TypeFlags::ES_SYMBOL_LIKE) {
            if self.strict_null_checks {
                return TypeFacts::SYMBOL_STRICT_FACTS;
            }
            return TypeFacts::SYMBOL_FACTS;
        }
        if flags.intersects(TypeFlags::NON_PRIMITIVE) {
            if self.strict_null_checks {
                return TypeFacts::OBJECT_STRICT_FACTS;
            }
            return TypeFacts::OBJECT_FACTS;
        }
        if flags.intersects(TypeFlags::NEVER) {
            return TypeFacts::NONE;
        }
        if flags.intersects(TypeFlags::UNION) {
            let mut facts = TypeFacts::NONE;
            for &t in self.type_types(t).as_slice() {
                facts |= self.get_type_facts_worker(t, caller_only_needs);
            }
            return facts;
        }
        if flags.intersects(TypeFlags::INTERSECTION) {
            return self.get_intersection_type_facts(t, caller_only_needs);
        }
        TypeFacts::UNKNOWN_FACTS
    }

    pub fn get_intersection_type_facts(
        &mut self,
        t: TypeId,
        caller_only_needs: TypeFacts,
    ) -> TypeFacts {
        // When an intersection contains a primitive type we ignore object type constituents as they are presumably type tags. For example, in string & { __kind__: "name" } we ignore the object type.
        let ignore_objects = self.maybe_type_of_kind(t, TypeFlags::PRIMITIVE);
        // When computing the type facts of an intersection type, certain type facts are computed as `and` and others are computed as `or`.
        let mut ored_facts = TypeFacts::NONE;
        let mut anded_facts = TypeFacts::ALL;
        for &t in self.type_types(t).as_slice() {
            if !(ignore_objects && self.types[t].flags.intersects(TypeFlags::OBJECT)) {
                let f = self.get_type_facts_worker(t, caller_only_needs);
                ored_facts |= f;
                anded_facts &= f;
            }
        }
        (ored_facts & TypeFacts::OR_FACTS_MASK) | (anded_facts & TypeFacts::AND_FACTS_MASK)
    }
}

pub fn is_zero_big_int(c: &Checker<'_>, t: TypeId) -> bool {
    get_big_int_literal_value(c, t) == PseudoBigInt::default()
}

impl<'a> Checker<'a> {
    pub fn is_function_object_type(&mut self, t: TypeId) -> bool {
        if self.types[t]
            .object_flags
            .intersects(ObjectFlags::EVOLVING_ARRAY)
        {
            return false;
        }
        // We do a quick check for a "bind" property before performing the more expensive subtype check. This gives us a quicker out in the common case where an object type is not a function.
        let resolved = self.resolve_structured_type_members(t);
        let signatures = self.as_structured_type(resolved).signatures;
        let members = self.as_structured_type(resolved).members;
        signatures.len() != 0
            || !self.ast.table_get(members, b"bind").is_nil()
                && self.is_type_subtype_of(t, self.global_function_type)
    }

    pub fn get_type_with_facts(&mut self, t: TypeId, include: TypeFacts) -> TypeId {
        self.filter_type(t, &mut |c, t| c.has_type_facts(t, include))
    }

    // This function is similar to getTypeWithFacts, except that in strictNullChecks mode it replaces type unknown with the union {} | null | undefined (and reduces that accordingly), and it intersects remaining instantiable types with {}, {} | null, or {} | undefined in order to remove null and/or undefined.
    pub fn get_adjusted_type_with_facts(&mut self, t: TypeId, facts: TypeFacts) -> TypeId {
        let source =
            if self.strict_null_checks && self.types[t].flags.intersects(TypeFlags::UNKNOWN) {
                self.unknown_union_type
            } else {
                t
            };
        let filtered = self.get_type_with_facts(source, facts);
        let reduced = self.recombine_unknown_type(filtered);
        if self.strict_null_checks {
            match facts {
                TypeFacts::NE_UNDEFINED => {
                    return self.remove_nullable_by_intersection(
                        reduced,
                        TypeFacts::EQ_UNDEFINED,
                        TypeFacts::EQ_NULL,
                        TypeFacts::IS_NULL,
                        self.null_type,
                    );
                }
                TypeFacts::NE_NULL => {
                    return self.remove_nullable_by_intersection(
                        reduced,
                        TypeFacts::EQ_NULL,
                        TypeFacts::EQ_UNDEFINED,
                        TypeFacts::IS_UNDEFINED,
                        self.undefined_type,
                    );
                }
                TypeFacts::NE_UNDEFINED_OR_NULL | TypeFacts::TRUTHY => {
                    return self.map_type(reduced, &mut |c, t| {
                        if c.has_type_facts(t, TypeFacts::EQ_UNDEFINED_OR_NULL) {
                            return c.get_global_non_nullable_type_instantiation(t);
                        }
                        t
                    });
                }
                _ => {}
            }
        }
        reduced
    }

    pub fn remove_nullable_by_intersection(
        &mut self,
        t: TypeId,
        target_facts: TypeFacts,
        other_facts: TypeFacts,
        other_includes_facts: TypeFacts,
        other_type: TypeId,
    ) -> TypeId {
        let facts = self.get_type_facts(
            t,
            TypeFacts::EQ_UNDEFINED
                | TypeFacts::EQ_NULL
                | TypeFacts::IS_UNDEFINED
                | TypeFacts::IS_NULL,
        );
        // Simply return the type if it never compares equal to the target nullable.
        if !facts.intersects(target_facts) {
            return t;
        }
        // By default we intersect with a union of {} and the opposite nullable.
        let empty_and_other_union =
            self.get_union_type(List::from_slice(&[self.empty_object_type, other_type]));
        // For each constituent type that can compare equal to the target nullable, intersect with the above union if the type doesn't already include the opposite nullable and the constituent can compare equal to the opposite nullable; otherwise, just intersect with {}.
        self.map_type(t, &mut |c, t| {
            if c.has_type_facts(t, target_facts) {
                if !facts.intersects(other_includes_facts) && c.has_type_facts(t, other_facts) {
                    return c.get_intersection_type(List::from_slice(&[t, empty_and_other_union]));
                }
                return c.get_intersection_type(List::from_slice(&[t, c.empty_object_type]));
            }
            t
        })
    }

    pub fn recombine_unknown_type(&self, t: TypeId) -> TypeId {
        if t == self.unknown_union_type {
            return self.unknown_type;
        }
        t
    }

    pub fn get_global_non_nullable_type_instantiation(&mut self, t: TypeId) -> TypeId {
        let alias = self.get_global_non_nullable_type_alias_or_nil();
        if !alias.is_nil() {
            return self.get_type_alias_instantiation(
                alias,
                List::from_slice(&[t]),
                TypeAliasId::NIL,
            );
        }
        self.get_intersection_type(List::from_slice(&[t, self.empty_object_type]))
    }

    pub fn convert_auto_to_any(&self, t: TypeId) -> TypeId {
        if t == self.auto_type {
            return self.any_type;
        }
        if t == self.auto_array_type {
            return self.any_array_type;
        }
        t
    }

    // Gets the "awaited type" of a type. @param type The type to await. @param withAlias When `true`, wraps the "awaited type" in `Awaited<T>` if needed. @remarks The "awaited type" of an expression is its "promised type" if the expression is a Promise-like type; otherwise, it is the type of the expression. This is used to reflect The runtime behavior of the `await` keyword.
    pub fn check_awaited_type(
        &mut self,
        t: TypeId,
        with_alias: bool,
        error_node: NodeId,
        diagnostic_message: MessageId,
    ) -> TypeId {
        let awaited_type = if with_alias {
            self.get_awaited_type_ex(t, error_node, diagnostic_message, &[])
        } else {
            self.get_awaited_type_no_alias_ex(t, error_node, diagnostic_message, &[])
        };
        if !awaited_type.is_nil() {
            return awaited_type;
        }
        self.error_type
    }

    // Gets the "awaited type" of a type. The "awaited type" of an expression is its "promised type" if the expression is a Promise-like type; otherwise, it is the type of the expression. If the "promised type" is itself a Promise-like, the "promised type" is recursively unwrapped until a non-promise type is found. This is used to reflect the runtime behavior of the `await` keyword.
    pub fn get_awaited_type(&mut self, t: TypeId) -> TypeId {
        self.get_awaited_type_ex(t, NodeId::NIL, MessageId::NIL, &[])
    }

    pub fn get_awaited_type_ex(
        &mut self,
        t: TypeId,
        error_node: NodeId,
        diagnostic_message: MessageId,
        args: &[Arg<'_>],
    ) -> TypeId {
        let awaited_type =
            self.get_awaited_type_no_alias_ex(t, error_node, diagnostic_message, args);
        if !awaited_type.is_nil() {
            return self.create_awaited_type_if_needed(awaited_type);
        }
        TypeId::NIL
    }

    // Gets the "awaited type" of a type without introducing an `Awaited<T>` wrapper.
    pub fn get_awaited_type_no_alias(&mut self, t: TypeId) -> TypeId {
        self.get_awaited_type_no_alias_ex(t, NodeId::NIL, MessageId::NIL, &[])
    }

    pub fn get_awaited_type_no_alias_ex(
        &mut self,
        t: TypeId,
        error_node: NodeId,
        diagnostic_message: MessageId,
        args: &[Arg<'_>],
    ) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if is_type_any(self, t) {
            return t;
        }
        // If this is already an `Awaited<T>`, just return it. This avoids `Awaited<Awaited<T>>` in higher-order
        if self.is_awaited_type_instantiation(t) {
            return t;
        }
        // If we've already cached an awaited type, return a possible `Awaited<T>` for it.
        let key = CachedTypeKey {
            kind: CachedTypeKind::AWAITED_TYPE,
            type_id: t,
        };
        let awaited_type = self.cached_types.get(&key);
        if !awaited_type.is_nil() {
            return awaited_type;
        }
        // For a union, get a union of the awaited types of each constituent.
        if self.types[t].flags.intersects(TypeFlags::UNION) {
            if self.awaited_type_stack.contains(&t) {
                if !error_node.is_nil() {
                    self.error(error_node, diagnostics::TYPE_IS_REFERENCED_DIRECTLY_OR_INDIRECTLY_IN_THE_FULFILLMENT_CALLBACK_OF_ITS_OWN_THEN_METHOD, &[]);
                }
                return TypeId::NIL;
            }
            self.awaited_type_stack.push(t);
            let mapped = self.map_type(t, &mut |c, t| {
                c.get_awaited_type_no_alias_ex(t, error_node, diagnostic_message, args)
            });
            self.awaited_type_stack.pop();
            let ok = self.cached_types.set(key, mapped);
            self.map_set(ok);
            return mapped;
        }
        // If `type` is generic and should be wrapped in `Awaited<T>`, return it.
        if self.is_awaited_type_needed(t) {
            let ok = self.cached_types.set(key, t);
            self.map_set(ok);
            return t;
        }
        let mut this_type_for_error = TypeId::NIL;
        let promised_type =
            self.get_promised_type_of_promise_ex(t, NodeId::NIL, Some(&mut this_type_for_error));
        if !promised_type.is_nil() {
            if t == promised_type || self.awaited_type_stack.contains(&promised_type) {
                // Verify that we don't have a bad actor in the form of a promise whose promised type is the same as the promise type, or a mutually recursive promise. If so, we return undefined as we cannot guess the shape. If this were the actual case in the JavaScript, this Promise would never resolve. An example of a bad actor with a singly-recursive promise type might be: interface BadPromise { then(onfulfilled: (value: BadPromise) => any, onrejected: (error: any) => any): BadPromise; } The above interface will pass the PromiseLike check, and return a promised type of `BadPromise`. Since this is a self reference, we don't want to keep recursing ad infinitum. An example of a bad actor in the form of a mutually-recursive promise type might be: interface BadPromiseA { then(onfulfilled: (value: BadPromiseB) => any, onrejected: (error: any) => any): BadPromiseB; } interface BadPromiseB { then(onfulfilled: (value: BadPromiseA) => any, onrejected: (error: any) => any): BadPromiseA; }
                if !error_node.is_nil() {
                    self.error(error_node, diagnostics::TYPE_IS_REFERENCED_DIRECTLY_OR_INDIRECTLY_IN_THE_FULFILLMENT_CALLBACK_OF_ITS_OWN_THEN_METHOD, &[]);
                }
                return TypeId::NIL;
            }
            // Keep track of the type we're about to unwrap to avoid bad recursive promise types. See the comments above for more information.
            self.awaited_type_stack.push(t);
            let awaited_type = self.get_awaited_type_no_alias_ex(
                promised_type,
                error_node,
                diagnostic_message,
                args,
            );
            self.awaited_type_stack.pop();
            if awaited_type.is_nil() {
                return TypeId::NIL;
            }
            let ok = self.cached_types.set(key, awaited_type);
            self.map_set(ok);
            return awaited_type;
        }
        // The type was not a promise, so it could not be unwrapped any further. As long as the type does not have a callable "then" property, it is safe to return the type; otherwise, an error is reported and we return undefined. An example of a non-promise "thenable" might be: await { then(): void {} } The "thenable" does not match the minimal definition for a promise. When a Promise/A+-compatible or ES6 promise tries to adopt this value, the promise will never settle. We treat this as an error to help flag an early indicator of a runtime problem. If the user wants to return this value from an async function, they would need to wrap it in some other value. If they want it to be treated as a promise, they can cast to <any>.
        if self.is_thenable_type(t) {
            if !error_node.is_nil() {
                let mut diagnostic = DiagnosticId::NIL;
                if !this_type_for_error.is_nil() {
                    let type_name = self.type_to_string_exported(t);
                    let this_type_name = self.type_to_string_exported(this_type_for_error);
                    diagnostic = self.new_diagnostic_for_node(
                        error_node,
                        diagnostics::THE_THIS_CONTEXT_OF_TYPE_0_IS_NOT_ASSIGNABLE_TO_METHOD_S_THIS_OF_TYPE_1,
                        &[Arg::Str(&type_name), Arg::Str(&this_type_name)],
                    );
                }
                if diagnostic_message.is_nil() {
                    // Upstream reads the message of a caller that passed none (getAsyncFromSyncIterationTypes): an internal fault here, and no diagnostic.
                    let _: () = self.fail("nil diagnostic message in getAwaitedTypeNoAliasEx");
                } else {
                    let chain = self.new_diagnostic_chain_for_node(
                        diagnostic,
                        error_node,
                        diagnostic_message,
                        args,
                    );
                    self.add_diagnostic(chain);
                }
            }
            return TypeId::NIL;
        }
        let ok = self.cached_types.set(key, t);
        self.map_set(ok);
        t
    }

    pub fn is_awaited_type_instantiation(&mut self, t: TypeId) -> bool {
        if self.types[t].flags.intersects(TypeFlags::CONDITIONAL) {
            let awaited_symbol = self.get_global_awaited_symbol_or_nil();
            let alias = self.types[t].alias;
            return !awaited_symbol.is_nil()
                && !alias.is_nil()
                && self.alias_symbol(alias) == awaited_symbol
                && self.alias_type_arguments(alias).len() == 1;
        }
        false
    }

    pub fn is_awaited_type_needed(&mut self, t: TypeId) -> bool {
        // If this is already an `Awaited<T>`, we shouldn't wrap it. This helps to avoid `Awaited<Awaited<T>>` in higher-order.
        if is_type_any(self, t) || self.is_awaited_type_instantiation(t) {
            return false;
        }
        // We only need `Awaited<T>` if `T` contains possibly non-primitive types.
        if self.is_generic_object_type(t) {
            let base_constraint = self.get_base_constraint_of_type(t);
            // We only need `Awaited<T>` if `T` is a type variable that has no base constraint, or the base constraint of `T` is `any`, `unknown`, `{}`, `object`, or is promise-like.
            if !base_constraint.is_nil() {
                return self.types[base_constraint]
                    .flags
                    .intersects(TypeFlags::ANY_OR_UNKNOWN)
                    || self.is_empty_object_type(base_constraint)
                    || some_type(self, base_constraint, &mut |c, t| c.is_thenable_type(t));
            }
            return self.maybe_type_of_kind(t, TypeFlags::TYPE_VARIABLE);
        }
        false
    }

    pub fn create_awaited_type_if_needed(&mut self, t: TypeId) -> TypeId {
        // We wrap type `T` in `Awaited<T>` based on the following conditions: `T` is not already an `Awaited<U>`, and `T` is generic, and one of the following applies: `T` has no base constraint, or the base constraint of `T` is `any`, `unknown`, `object`, or `{}`, or the base constraint of `T` is an object type with a callable `then` method.
        if self.is_awaited_type_needed(t) {
            let awaited_type = self.try_create_awaited_type(t);
            if !awaited_type.is_nil() {
                return awaited_type;
            }
        }
        t
    }

    pub fn try_create_awaited_type(&mut self, t: TypeId) -> TypeId {
        // Nothing to do if `Awaited<T>` doesn't exist
        let awaited_symbol = self.get_global_awaited_symbol();
        if !awaited_symbol.is_nil() {
            // Unwrap unions that may contain `Awaited<T>`, otherwise its possible to manufacture an `Awaited<Awaited<T> | U>` where an `Awaited<T | U>` would suffice.
            let unwrapped = self.unwrap_awaited_type(t);
            return self.get_type_alias_instantiation(
                awaited_symbol,
                List::from_slice(&[unwrapped]),
                TypeAliasId::NIL,
            );
        }
        TypeId::NIL
    }

    // For a generic `Awaited<T>`, gets `T`.
    pub fn unwrap_awaited_type(&mut self, t: TypeId) -> TypeId {
        if self.types[t].flags.intersects(TypeFlags::UNION) {
            return self.map_type(t, &mut |c, t| c.unwrap_awaited_type(t));
        }
        if self.is_awaited_type_instantiation(t) {
            return self.alias_type_arguments(self.types[t].alias).at(0usize);
        }
        t
    }

    pub fn is_thenable_type(&mut self, t: TypeId) -> bool {
        let constraint = self.get_base_constraint_or_type(t);
        if self.all_types_assignable_to_kind(constraint, TypeFlags::PRIMITIVE | TypeFlags::NEVER) {
            // primitive types cannot be considered "thenable" since they are not objects.
            return false;
        }
        let then_function = self.get_type_of_property_of_type(t, b"then");
        if then_function.is_nil() {
            return false;
        }
        let then_type = self.get_type_with_facts(then_function, TypeFacts::NE_UNDEFINED_OR_NULL);
        self.get_signatures_of_type(then_type, SignatureKind::CALL)
            .len()
            != 0
    }

    pub fn get_awaited_type_of_promise(&mut self, t: TypeId) -> TypeId {
        self.get_awaited_type_of_promise_ex(t, NodeId::NIL, MessageId::NIL, &[])
    }

    pub fn get_awaited_type_of_promise_ex(
        &mut self,
        t: TypeId,
        error_node: NodeId,
        diagnostic_message: MessageId,
        args: &[Arg<'_>],
    ) -> TypeId {
        let promised_type = self.get_promised_type_of_promise_ex(t, error_node, None);
        if !promised_type.is_nil() {
            return self.get_awaited_type_ex(promised_type, error_node, diagnostic_message, args);
        }
        TypeId::NIL
    }

    pub fn get_target_type(&self, t: TypeId) -> TypeId {
        if self.types[t]
            .object_flags
            .intersects(ObjectFlags::REFERENCE)
        {
            return self.as_object_type(t).target;
        }
        t
    }

    pub fn get_actual_type_variable(&mut self, t: TypeId) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if self.types[t].flags.intersects(TypeFlags::SUBSTITUTION) {
            let base_type = self.as_substitution_type(t).base_type;
            return self.get_actual_type_variable(base_type);
        }
        if self.types[t].flags.intersects(TypeFlags::INDEXED_ACCESS) {
            let object_type = self.as_indexed_access_type(t).object_type;
            let index_type = self.as_indexed_access_type(t).index_type;
            if self.types[object_type]
                .flags
                .intersects(TypeFlags::SUBSTITUTION)
                || self.types[index_type]
                    .flags
                    .intersects(TypeFlags::SUBSTITUTION)
            {
                let actual_object_type = self.get_actual_type_variable(object_type);
                let actual_index_type = self.get_actual_type_variable(index_type);
                return self.get_indexed_access_type(actual_object_type, actual_index_type);
            }
        }
        t
    }
}
