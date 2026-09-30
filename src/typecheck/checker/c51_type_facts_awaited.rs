// checker.go:31097-31702 (layers E-AWAIT, K-PRED, K-SUBST): the functions of 31355-31591, 31607-31612 and 31694-31702: awaited types, the target of a reference and the type variable behind substitution types.
use crate::ast::{Arg, DiagnosticId, NodeId};
use crate::checker::{
    CachedTypeKey, CachedTypeKind, Checker, ObjectFlags, SignatureKind, TypeAliasId, TypeFacts,
    TypeFlags, TypeId, is_type_any, some_type,
};
use crate::core::List;
use crate::diagnostics::{self, MessageId};

impl<'a> Checker<'a> {
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
