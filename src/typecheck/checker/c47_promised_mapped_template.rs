// checker.go:29042-29447 (layers E-AWAIT, T-SIGSHAPE, T-SYMTYPE, T-CONSTRAINT, K-TEMPLATE): the functions of 29042-29133, 29198-29227 and 29255-29344: the promised type of a promise, the type of the first parameter of a signature, optional type markers and missing types, the constraint declaration of a type parameter, and template literal type construction.
use crate::ast::{Arg, NodeId, is_outermost_optional_chain, is_type_parameter_declaration};
use crate::checker::{
    CachedTypeKey, CachedTypeKind, Checker, RelationKind, SignatureId, SignatureKind, TypeAliasId,
    TypeFacts, TypeFlags, TypeId, UnionReduction, get_template_type_key, is_type_any,
};
use crate::core::{List, Text};
use crate::diagnostics;
use crate::evaluator::any_to_string;
use crate::stringutil::combine_surrogate_pairs;

impl<'a> Checker<'a> {
    pub fn get_promised_type_of_promise(&mut self, t: TypeId) -> TypeId {
        self.get_promised_type_of_promise_ex(t, NodeId::NIL, None)
    }

    // Gets the "promised type" of a promise. @param type The type of the promise. @remarks The "promised type" of a type is the type of the "value" parameter of the "onfulfilled" callback.
    pub fn get_promised_type_of_promise_ex(
        &mut self,
        t: TypeId,
        error_node: NodeId,
        this_type_for_error_out: Option<&mut TypeId>,
    ) -> TypeId {
        // { // type then( // thenFunction onfulfilled: ( // onfulfilledParameterType value: T // valueParameterType ) => any ): any; }
        if is_type_any(self, t) {
            return TypeId::NIL;
        }
        let key = CachedTypeKey {
            kind: CachedTypeKind::PROMISED_TYPE_OF_PROMISE,
            type_id: t,
        };
        let cached = self.cached_types.get(&key);
        if !cached.is_nil() {
            return cached;
        }
        let global_promise_type = self.get_global_promise_type();
        if self.is_reference_to_type(t, global_promise_type) {
            let result = self.get_type_arguments(t).at(0usize);
            let ok = self.cached_types.set(key, result);
            self.map_set(ok);
            return result;
        }
        // primitives with a `{ then() }` won't be unwrapped/adopted.
        let constraint = self.get_base_constraint_or_type(t);
        if self.all_types_assignable_to_kind(constraint, TypeFlags::PRIMITIVE | TypeFlags::NEVER) {
            return TypeId::NIL;
        }
        let then_function = self.get_type_of_property_of_type(t, b"then");
        // TODO: GH#18217
        if is_type_any(self, then_function) {
            return TypeId::NIL;
        }
        let mut then_signatures: List<'a, SignatureId> = List::NIL;
        if !then_function.is_nil() {
            then_signatures = self.get_signatures_of_type(then_function, SignatureKind::CALL);
        }
        if then_signatures.len() == 0 {
            if !error_node.is_nil() {
                self.error(
                    error_node,
                    diagnostics::A_PROMISE_MUST_HAVE_A_THEN_METHOD,
                    &[],
                );
            }
            return TypeId::NIL;
        }
        let mut this_type_for_error = TypeId::NIL;
        let mut candidates: Vec<SignatureId> = Vec::new();
        for &then_signature in then_signatures.as_slice() {
            let this_type = self.get_this_type_of_signature(then_signature);
            if !this_type.is_nil()
                && this_type != self.void_type
                && !self.is_type_related_to(t, this_type, RelationKind::Subtype)
            {
                this_type_for_error = this_type;
            } else {
                candidates.push(then_signature);
            }
        }
        if candidates.is_empty() {
            self.assert(!this_type_for_error.is_nil(), "thisTypeForError != nil");
            if let Some(out) = this_type_for_error_out {
                *out = this_type_for_error;
            }
            if !error_node.is_nil() {
                let type_name = self.type_to_string_exported(t);
                let this_type_name = self.type_to_string_exported(this_type_for_error);
                self.error(
                    error_node,
                    diagnostics::THE_THIS_CONTEXT_OF_TYPE_0_IS_NOT_ASSIGNABLE_TO_METHOD_S_THIS_OF_TYPE_1,
                    &[Arg::Str(&type_name), Arg::Str(&this_type_name)],
                );
            }
            return TypeId::NIL;
        }
        let first_parameter_types = self.map_list(List::from_slice(&candidates), |c, s| {
            c.get_type_of_first_parameter_of_signature(s)
        });
        let first_parameter_type = self.get_union_type(first_parameter_types);
        let onfulfilled_parameter_type =
            self.get_type_with_facts(first_parameter_type, TypeFacts::NE_UNDEFINED_OR_NULL);
        if is_type_any(self, onfulfilled_parameter_type) {
            return TypeId::NIL;
        }
        let onfulfilled_parameter_signatures =
            self.get_signatures_of_type(onfulfilled_parameter_type, SignatureKind::CALL);
        if onfulfilled_parameter_signatures.len() == 0 {
            if !error_node.is_nil() {
                self.error(
                    error_node,
                    diagnostics::THE_FIRST_PARAMETER_OF_THE_THEN_METHOD_OF_A_PROMISE_MUST_BE_A_CALLBACK,
                    &[],
                );
            }
            return TypeId::NIL;
        }
        let value_parameter_types = self.map_list(onfulfilled_parameter_signatures, |c, s| {
            c.get_type_of_first_parameter_of_signature(s)
        });
        let result = self.get_union_type_ex(
            value_parameter_types,
            UnionReduction::SUBTYPE,
            TypeAliasId::NIL,
            TypeId::NIL,
        );
        let ok = self.cached_types.set(key, result);
        self.map_set(ok);
        result
    }

    pub fn get_type_of_first_parameter_of_signature(&mut self, signature: SignatureId) -> TypeId {
        self.get_type_of_first_parameter_of_signature_with_fallback(signature, self.never_type)
    }

    pub fn get_type_of_first_parameter_of_signature_with_fallback(
        &mut self,
        signature: SignatureId,
        fallback_type: TypeId,
    ) -> TypeId {
        if self.signatures[signature].parameters.len() > 0 {
            return self.get_type_at_position(signature, 0);
        }
        fallback_type
    }

    pub fn remove_optional_type_marker(&mut self, t: TypeId) -> TypeId {
        if self.strict_null_checks {
            return self.remove_type(t, self.optional_type);
        }
        t
    }

    pub fn propagate_optional_type_marker(
        &mut self,
        t: TypeId,
        node: NodeId,
        was_optional: bool,
    ) -> TypeId {
        if was_optional {
            if is_outermost_optional_chain(self.ast, node) {
                return self.get_optional_type(t, false);
            }
            return self.add_optional_type_marker(t);
        }
        t
    }

    pub fn remove_missing_type(&mut self, t: TypeId, is_optional: bool) -> TypeId {
        if self.exact_optional_property_types && is_optional {
            return self.remove_type(t, self.missing_type);
        }
        t
    }

    pub fn remove_missing_or_undefined_type(&mut self, t: TypeId) -> TypeId {
        if self.exact_optional_property_types {
            return self.remove_type(t, self.missing_type);
        }
        self.get_type_with_facts(t, TypeFacts::NE_UNDEFINED)
    }

    pub fn get_constraint_declaration(&self, t: TypeId) -> NodeId {
        let a = self.ast;
        let symbol = self.types[t].symbol;
        if !symbol.is_nil() {
            for &d in a.sym(symbol).declarations.as_slice() {
                if is_type_parameter_declaration(a, d) {
                    let constraint = a.as_type_parameter_declaration(d).constraint;
                    if !constraint.is_nil() {
                        return constraint;
                    }
                }
            }
        }
        NodeId::NIL
    }

    pub fn get_template_literal_type(
        &mut self,
        texts: &[&[u8]],
        types: List<'_, TypeId>,
    ) -> TypeId {
        // The spans of one list: literal parts are folded into the text, nested template literals are flattened, generic and placeholder parts stay. Upstream writes this as a closure over the builder and the two new lists.
        fn add_spans(
            c: &mut Checker<'_>,
            texts: &[&[u8]],
            types: &[TypeId],
            new_types: &mut Vec<TypeId>,
            new_texts: &mut Vec<Vec<u8>>,
            sb: &mut Vec<u8>,
        ) -> bool {
            for (i, &t) in types.iter().enumerate() {
                let flags = c.types[t].flags;
                let next_text: &[u8] = texts.get(i + 1).copied().unwrap_or(b"");
                if flags.intersects(TypeFlags::LITERAL | TypeFlags::NULL | TypeFlags::UNDEFINED) {
                    sb.extend_from_slice(&c.get_template_string_for_type(t));
                    sb.extend_from_slice(next_text);
                } else if flags.intersects(TypeFlags::TEMPLATE_LITERAL) {
                    let nested_texts = c.as_template_literal_type(t).texts.as_slice();
                    let nested_types = c.as_template_literal_type(t).types.as_slice();
                    sb.extend_from_slice(nested_texts.first().copied().unwrap_or(b""));
                    if !add_spans(c, nested_texts, nested_types, new_types, new_texts, sb) {
                        return false;
                    }
                    sb.extend_from_slice(next_text);
                } else if c.is_generic_index_type(t) || c.is_pattern_literal_placeholder_type(t) {
                    new_types.push(t);
                    new_texts.push(combine_surrogate_pairs(sb).into_owned());
                    sb.clear();
                    sb.extend_from_slice(next_text);
                } else {
                    return false;
                }
            }
            true
        }
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let type_list = types.as_slice();
        let union_index = type_list.iter().position(|&t| {
            self.types[t]
                .flags
                .intersects(TypeFlags::NEVER | TypeFlags::UNION)
        });
        if let Some(union_index) = union_index {
            if !self.check_cross_product_union(types) {
                return self.error_type;
            }
            let union_type = type_list.get(union_index).copied().unwrap_or(TypeId::NIL);
            return self.map_type(union_type, &mut |c, t| {
                let mut replaced: Vec<TypeId> = type_list.to_vec();
                if let Some(slot) = replaced.get_mut(union_index) {
                    *slot = t;
                }
                c.get_template_literal_type(texts, List::from_slice(&replaced))
            });
        }
        if type_list.contains(&self.wildcard_type) {
            return self.wildcard_type;
        }
        let mut new_types: Vec<TypeId> = Vec::new();
        let mut new_texts: Vec<Vec<u8>> = Vec::new();
        let mut sb: Vec<u8> = Vec::new();
        sb.extend_from_slice(texts.first().copied().unwrap_or(b""));
        if !add_spans(
            self,
            texts,
            type_list,
            &mut new_types,
            &mut new_texts,
            &mut sb,
        ) {
            return self.string_type;
        }
        if new_types.is_empty() {
            let text = self.text(&combine_surrogate_pairs(&sb));
            return self.get_string_literal_type(text);
        }
        new_texts.push(combine_surrogate_pairs(&sb).into_owned());
        if new_texts.iter().all(|t| t.is_empty()) {
            if new_types
                .iter()
                .all(|&t| self.types[t].flags.intersects(TypeFlags::STRING))
            {
                return self.string_type;
            }
            // Normalize `${Mapping<xxx>}` into Mapping<xxx>
            if let [only] = new_types.as_slice() {
                if self.is_pattern_literal_type(*only) {
                    return *only;
                }
            }
        }
        // The key is made from the local lists: the texts and types are copied into the arena only for a new type.
        let text_views: Vec<&[u8]> = new_texts.iter().map(Vec::as_slice).collect();
        let key =
            get_template_type_key(List::from_slice(&text_views), List::from_slice(&new_types));
        let mut t = self.template_literal_types.get(&key);
        if t.is_nil() {
            let stored_texts: Vec<Text<'a>> =
                new_texts.iter().map(|text| self.text(text)).collect();
            let stored_texts = self.list_of(&stored_texts);
            let stored_types = self.list_of(&new_types);
            t = self.new_template_literal_type(stored_texts, stored_types);
            let ok = self.template_literal_types.set(key, t);
            self.map_set(ok);
        }
        t
    }

    pub fn get_template_string_for_type(&self, t: TypeId) -> Vec<u8> {
        let flags = self.types[t].flags;
        if flags.intersects(
            TypeFlags::STRING_LITERAL
                | TypeFlags::NUMBER_LITERAL
                | TypeFlags::BOOLEAN_LITERAL
                | TypeFlags::BIG_INT_LITERAL,
        ) {
            return any_to_string(&self.as_literal_type(t).value);
        }
        if flags.intersects(TypeFlags::NULLABLE) {
            return self.as_intrinsic_type(t).intrinsic_name.to_vec();
        }
        Vec::new()
    }
}
