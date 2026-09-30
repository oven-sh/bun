// checker.go:27551-28310 (layers T-CONSTRAINT, K-PRED, T-UIMEMBERS, T-SIGSHAPE, K-INDEXED, T-WIDEN): the functions of 27551-27827, 27855-27986, 28025-28033 and 28278-28310: base constraints, kind tests over types, const enum tests, the comparison of two properties, signature parameters expanded from a tuple rest type, rest parameter tests, the cached union predicates, the dispatcher of type simplification, extractTypesOfKind and the regular type of an object literal.
use crate::ast::{
    Arg, Ast, CheckFlags, ModifierFlags, NodeId, SymbolFlags, SymbolId, SymbolTable,
    is_node_descendant_of,
};
use crate::checker::{
    CachedTypeKey, CachedTypeKind, Checker, ElementFlags, IndexFlags, IndexInfoId, ObjectFlags,
    RecursionId, SignatureId, Ternary, TypeAliasId, TypeFlags, TypeId, TypeSystemEntity,
    TypeSystemPropertyName, every_type, get_declaration_modifier_flags_from_symbol,
    get_recursion_identity, is_object_literal_type,
};
use crate::core::List;
use crate::diagnostics;
use crate::scanner::declaration_name_to_string;
use std::collections::BTreeMap;

// `s[i]` as a guarded read: the nil id when the index is outside the slice.
fn at(types: &[TypeId], index: usize) -> TypeId {
    types.get(index).copied().unwrap_or(TypeId::NIL)
}

impl<'a> Checker<'a> {
    pub fn get_base_constraint_or_type(&mut self, t: TypeId) -> TypeId {
        let constraint = self.get_base_constraint_of_type(t);
        if !constraint.is_nil() {
            return constraint;
        }
        t
    }

    pub fn get_base_constraint_of_type(&mut self, t: TypeId) -> TypeId {
        if self.types[t].flags.intersects(
            TypeFlags::INSTANTIABLE_NON_PRIMITIVE
                | TypeFlags::UNION_OR_INTERSECTION
                | TypeFlags::TEMPLATE_LITERAL
                | TypeFlags::STRING_MAPPING
                | TypeFlags::INDEX,
        ) || self.is_generic_tuple_type(t)
        {
            let constraint = self.get_resolved_base_constraint(t, &mut Vec::new());
            if constraint != self.no_constraint_type && constraint != self.circular_constraint_type
            {
                return constraint;
            }
            return TypeId::NIL;
        }
        TypeId::NIL
    }

    // Upstream passes the stack of recursion identities by value and extends it with append: here the one stack is pushed before the nested call and truncated after it.
    pub fn get_resolved_base_constraint(
        &mut self,
        t: TypeId,
        stack: &mut Vec<RecursionId>,
    ) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        if !self.has_constrained_type(t) {
            return t;
        }
        let resolved_base_constraint = self.as_constrained_type(t).resolved_base_constraint;
        if !resolved_base_constraint.is_nil() {
            return resolved_base_constraint;
        }
        if !self.push_type_resolution(
            TypeSystemEntity::Type(t),
            TypeSystemPropertyName::ResolvedBaseConstraint,
        ) {
            return self.circular_constraint_type;
        }
        let mut constraint = TypeId::NIL;
        // We always explore at least 10 levels of nested constraints. Thereafter, we continue to explore up to 50 levels of nested constraints provided there are no "deeply nested" types on the stack (i.e. no types for which five instantiations have been recorded on the stack). If we reach 50 levels of nesting, we are presumably exploring a repeating pattern with a long cycle that hasn't yet triggered the deeply nested limiter. We have no test cases that actually get to 50 levels of nesting, so it is effectively just a safety stop.
        let identity = get_recursion_identity(self, t);
        if stack.len() < 10 || stack.len() < 50 && !stack.contains(&identity) {
            let simplified = self.get_simplified_type(t, false);
            let depth = stack.len();
            stack.push(identity);
            constraint = self.compute_base_constraint(simplified, stack);
            stack.truncate(depth);
        }
        if !self.pop_type_resolution() {
            if self.types[t].flags.intersects(TypeFlags::TYPE_PARAMETER) {
                let error_node = self.get_constraint_declaration(t);
                if !error_node.is_nil() {
                    let type_name = self.type_to_string_exported(t);
                    let diagnostic = self.error(
                        error_node,
                        diagnostics::TYPE_PARAMETER_0_HAS_A_CIRCULAR_CONSTRAINT,
                        &[Arg::Str(&type_name)],
                    );
                    let current_node = self.current_node;
                    if !current_node.is_nil()
                        && !is_node_descendant_of(a, error_node, current_node)
                        && !is_node_descendant_of(a, current_node, error_node)
                    {
                        let related = self.new_diagnostic_for_node(
                            current_node,
                            diagnostics::CIRCULARITY_ORIGINATES_IN_TYPE_AT_THIS_LOCATION,
                            &[],
                        );
                        self.diagnostic_store.add_related_info(diagnostic, related);
                    }
                }
            }
            constraint = self.circular_constraint_type;
        }
        if constraint.is_nil() {
            constraint = self.no_constraint_type;
        }
        if self
            .as_constrained_type(t)
            .resolved_base_constraint
            .is_nil()
        {
            self.as_constrained_type_mut(t).resolved_base_constraint = constraint;
        }
        constraint
    }

    pub fn compute_base_constraint(&mut self, t: TypeId, stack: &mut Vec<RecursionId>) -> TypeId {
        let flags = self.types[t].flags;
        if flags.intersects(TypeFlags::TYPE_PARAMETER) {
            let constraint = self.get_constraint_from_type_parameter(t);
            if self.as_type_parameter(t).is_this_type {
                return constraint;
            }
            return self.get_next_base_constraint(constraint, stack);
        }
        if flags.intersects(TypeFlags::UNION_OR_INTERSECTION) {
            let types = self.type_types(t);
            let mut constraints: Vec<TypeId> = Vec::with_capacity(types.as_slice().len());
            let mut different = false;
            for &s in types.as_slice() {
                let constraint = self.get_next_base_constraint(s, stack);
                if !constraint.is_nil() {
                    if constraint != s {
                        different = true;
                    }
                    constraints.push(constraint);
                } else {
                    different = true;
                }
            }
            if !different {
                return t;
            }
            if flags.intersects(TypeFlags::UNION) && constraints.len() == types.as_slice().len() {
                return self.get_union_type(List::from_slice(&constraints));
            }
            if flags.intersects(TypeFlags::INTERSECTION) && !constraints.is_empty() {
                return self.get_intersection_type(List::from_slice(&constraints));
            }
            return TypeId::NIL;
        }
        if flags.intersects(TypeFlags::INDEX) {
            let mapped_type = self.as_index_type(t).target;
            if self.is_generic_mapped_type(mapped_type)
                && !self.get_name_type_from_mapped_type(mapped_type).is_nil()
                && !self.is_mapped_type_with_keyof_constraint_declaration(mapped_type)
            {
                let index_type = self.get_index_type_for_mapped_type(mapped_type, IndexFlags::NONE);
                return self.get_next_base_constraint(index_type, stack);
            }
            return self.string_number_symbol_type;
        }
        if flags.intersects(TypeFlags::TEMPLATE_LITERAL) {
            let types = self.type_types(t);
            let mut constraints: Vec<TypeId> = Vec::with_capacity(types.as_slice().len());
            for &s in types.as_slice() {
                let constraint = self.get_next_base_constraint(s, stack);
                if !constraint.is_nil() {
                    constraints.push(constraint);
                }
            }
            if constraints.len() == types.as_slice().len() {
                let texts = self.as_template_literal_type(t).texts;
                return self
                    .get_template_literal_type(texts.as_slice(), List::from_slice(&constraints));
            }
            return self.string_type;
        }
        if flags.intersects(TypeFlags::STRING_MAPPING) {
            let target = self.type_target(t);
            let constraint = self.get_next_base_constraint(target, stack);
            if !constraint.is_nil() && constraint != self.type_target(t) {
                let symbol = self.types[t].symbol;
                return self.get_string_mapping_type(symbol, constraint);
            }
            return self.string_type;
        }
        if flags.intersects(TypeFlags::INDEXED_ACCESS) {
            let object_type = self.as_indexed_access_type(t).object_type;
            let index_type = self.as_indexed_access_type(t).index_type;
            if self.is_mapped_type_generic_indexed_access(t) {
                // For indexed access types of the form { [P in K]: E }[X], where K is non-generic and X is generic, we substitute an instantiation of E where P is replaced with X.
                let substituted = self.substitute_indexed_mapped_type(object_type, index_type);
                return self.get_next_base_constraint(substituted, stack);
            }
            let base_object_type = self.get_next_base_constraint(object_type, stack);
            let base_index_type = self.get_next_base_constraint(index_type, stack);
            if base_object_type.is_nil() || base_index_type.is_nil() {
                return TypeId::NIL;
            }
            let access_flags = self.as_indexed_access_type(t).access_flags;
            let indexed_access = self.get_indexed_access_type_or_undefined(
                base_object_type,
                base_index_type,
                access_flags,
                NodeId::NIL,
                TypeAliasId::NIL,
            );
            return self.get_next_base_constraint(indexed_access, stack);
        }
        if flags.intersects(TypeFlags::CONDITIONAL) {
            if self.conditional_constraint_depth >= 100 {
                return TypeId::NIL;
            }
            self.conditional_constraint_depth += 1;
            let constraint = self.get_constraint_from_conditional_type(t);
            self.conditional_constraint_depth -= 1;
            return self.get_next_base_constraint(constraint, stack);
        }
        if flags.intersects(TypeFlags::SUBSTITUTION) {
            let intersection = self.get_substitution_intersection(t);
            return self.get_next_base_constraint(intersection, stack);
        }
        if self.is_generic_tuple_type(t) {
            // We substitute constraints for variadic elements only when the constraints are array types or non-variadic tuple types as we want to avoid further (possibly unbounded) recursion.
            let element_types = self.get_element_types(t);
            let element_infos = self.type_target_tuple_type(t).element_infos;
            let mut new_elements: Vec<TypeId> = Vec::with_capacity(element_types.as_slice().len());
            for (i, &v) in element_types.as_slice().iter().enumerate() {
                let mut new_element = v;
                if self.types[v].flags.intersects(TypeFlags::TYPE_PARAMETER)
                    && element_infos.at(i).flags.intersects(ElementFlags::VARIADIC)
                {
                    let constraint = self.get_next_base_constraint(v, stack);
                    if !constraint.is_nil()
                        && constraint != v
                        && every_type(self, constraint, &mut |c, n| {
                            c.is_array_or_tuple_type(n) && !c.is_generic_tuple_type(n)
                        })
                    {
                        new_element = constraint;
                    }
                }
                new_elements.push(new_element);
            }
            let readonly = self.type_target_tuple_type(t).readonly;
            let new_elements = self.list_of(&new_elements);
            return self.create_tuple_type_ex(new_elements, element_infos, readonly);
        }
        t
    }

    pub fn get_next_base_constraint(&mut self, t: TypeId, stack: &mut Vec<RecursionId>) -> TypeId {
        if t.is_nil() {
            return TypeId::NIL;
        }
        let constraint = self.get_resolved_base_constraint(t, stack);
        if constraint == self.no_constraint_type || constraint == self.circular_constraint_type {
            return TypeId::NIL;
        }
        constraint
    }

    // Return true if type might be of the given kind. A union or intersection type might be of a given kind if at least one constituent type is of the given kind.
    pub fn maybe_type_of_kind(&self, t: TypeId, kind: TypeFlags) -> bool {
        if self.types[t].flags.intersects(kind) {
            return true;
        }
        if self.types[t]
            .flags
            .intersects(TypeFlags::UNION_OR_INTERSECTION)
        {
            if !self.stack_check.is_safe_to_recurse() {
                return self.stack_limit();
            }
            for &constituent in self.type_types(t).as_slice() {
                if self.maybe_type_of_kind(constituent, kind) {
                    return true;
                }
            }
        }
        false
    }

    pub fn maybe_type_of_kind_considering_base_constraint(
        &mut self,
        t: TypeId,
        kind: TypeFlags,
    ) -> bool {
        if self.maybe_type_of_kind(t, kind) {
            return true;
        }
        let base_constraint = self.get_base_constraint_or_type(t);
        !base_constraint.is_nil() && self.maybe_type_of_kind(base_constraint, kind)
    }

    pub fn all_types_assignable_to_kind(&mut self, source: TypeId, kind: TypeFlags) -> bool {
        self.all_types_assignable_to_kind_ex(source, kind, false)
    }

    pub fn all_types_assignable_to_kind_ex(
        &mut self,
        source: TypeId,
        kind: TypeFlags,
        strict: bool,
    ) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if self.types[source].flags.intersects(TypeFlags::UNION) {
            let types = self.type_types(source);
            for &sub_type in types.as_slice() {
                if !self.all_types_assignable_to_kind_ex(sub_type, kind, strict) {
                    return false;
                }
            }
            return true;
        }
        self.is_type_assignable_to_kind_ex(source, kind, strict)
    }

    pub fn is_type_assignable_to_kind(&mut self, source: TypeId, kind: TypeFlags) -> bool {
        self.is_type_assignable_to_kind_ex(source, kind, false)
    }

    pub fn is_type_assignable_to_kind_ex(
        &mut self,
        source: TypeId,
        kind: TypeFlags,
        strict: bool,
    ) -> bool {
        if self.types[source].flags.intersects(kind) {
            return true;
        }
        if strict
            && self.types[source].flags.intersects(
                TypeFlags::ANY_OR_UNKNOWN
                    | TypeFlags::VOID
                    | TypeFlags::UNDEFINED
                    | TypeFlags::NULL,
            )
        {
            return false;
        }
        kind.intersects(TypeFlags::NUMBER_LIKE)
            && self.is_type_assignable_to(source, self.number_type)
            || kind.intersects(TypeFlags::BIG_INT_LIKE)
                && self.is_type_assignable_to(source, self.bigint_type)
            || kind.intersects(TypeFlags::STRING_LIKE)
                && self.is_type_assignable_to(source, self.string_type)
            || kind.intersects(TypeFlags::BOOLEAN_LIKE)
                && self.is_type_assignable_to(source, self.boolean_type)
            || kind.intersects(TypeFlags::VOID)
                && self.is_type_assignable_to(source, self.void_type)
            || kind.intersects(TypeFlags::NEVER)
                && self.is_type_assignable_to(source, self.never_type)
            || kind.intersects(TypeFlags::NULL)
                && self.is_type_assignable_to(source, self.null_type)
            || kind.intersects(TypeFlags::UNDEFINED)
                && self.is_type_assignable_to(source, self.undefined_type)
            || kind.intersects(TypeFlags::ES_SYMBOL)
                && self.is_type_assignable_to(source, self.es_symbol_type)
            || kind.intersects(TypeFlags::NON_PRIMITIVE)
                && self.is_type_assignable_to(source, self.non_primitive_type)
    }
}

pub fn is_const_enum_object_type(c: &Checker<'_>, t: TypeId) -> bool {
    c.types[t].object_flags.intersects(ObjectFlags::ANONYMOUS)
        && !c.types[t].symbol.is_nil()
        && is_const_enum_symbol(c.ast, c.types[t].symbol)
}

pub fn is_const_enum_symbol(a: Ast<'_>, symbol: SymbolId) -> bool {
    a.sym(symbol).flags.intersects(SymbolFlags::CONST_ENUM)
}

impl<'a> Checker<'a> {
    pub fn compare_properties(
        &mut self,
        source_prop: SymbolId,
        target_prop: SymbolId,
        compare_types: &mut dyn FnMut(&mut Checker<'a>, TypeId, TypeId) -> Ternary,
    ) -> Ternary {
        let a = self.ast;
        // Two members are considered identical when - they are public properties with identical names, optionality, and types, - they are private or protected properties originating in the same declaration and having identical types
        if source_prop == target_prop {
            return Ternary::TRUE;
        }
        let source_prop_accessibility = get_declaration_modifier_flags_from_symbol(a, source_prop)
            & ModifierFlags::NON_PUBLIC_ACCESSIBILITY_MODIFIER;
        let target_prop_accessibility = get_declaration_modifier_flags_from_symbol(a, target_prop)
            & ModifierFlags::NON_PUBLIC_ACCESSIBILITY_MODIFIER;
        if source_prop_accessibility != target_prop_accessibility {
            return Ternary::FALSE;
        }
        if source_prop_accessibility != ModifierFlags::NONE {
            let source_target = self.get_target_symbol(source_prop);
            let target_target = self.get_target_symbol(target_prop);
            if source_target != target_target {
                return Ternary::FALSE;
            }
        } else if (a.sym(source_prop).flags & SymbolFlags::OPTIONAL)
            != (a.sym(target_prop).flags & SymbolFlags::OPTIONAL)
        {
            return Ternary::FALSE;
        }
        let source_is_readonly = self.is_readonly_symbol(source_prop);
        let target_is_readonly = self.is_readonly_symbol(target_prop);
        if source_is_readonly != target_is_readonly {
            return Ternary::FALSE;
        }
        let source_type = self.get_non_missing_type_of_symbol(source_prop);
        let target_type = self.get_non_missing_type_of_symbol(target_prop);
        compare_types(self, source_type, target_type)
    }
}

// The callback of compareProperties gets the checker first, so this comparer takes it too.
pub fn compare_types_equal(_c: &mut Checker<'_>, s: TypeId, t: TypeId) -> Ternary {
    if s == t {
        return Ternary::TRUE;
    }
    Ternary::FALSE
}

impl<'a> Checker<'a> {
    pub fn expand_signature_parameters_with_tuple_members(
        &mut self,
        signature: SignatureId,
        rest_type: TypeId,
        rest_index: isize,
        rest_symbol: SymbolId,
    ) -> List<'a, SymbolId> {
        let element_types = self.get_type_arguments(rest_type);
        let element_infos = self.type_target_tuple_type(rest_type).element_infos;
        let associated_names =
            self.get_uniq_associated_names_from_tuple_type(rest_type, rest_symbol);
        let parameters = self.signatures[signature].parameters.as_slice();
        let fixed_count = usize::try_from(rest_index)
            .unwrap_or(0)
            .min(parameters.len());
        let mut expanded: Vec<SymbolId> =
            Vec::with_capacity(fixed_count + element_types.as_slice().len());
        expanded.extend_from_slice(parameters.get(..fixed_count).unwrap_or(&[]));
        for (i, &t) in element_types.as_slice().iter().enumerate() {
            let flags = element_infos.at(i).flags;
            let mut check_flags = CheckFlags::NONE;
            if flags.intersects(ElementFlags::VARIABLE) {
                check_flags = CheckFlags::REST_PARAMETER;
            } else if flags.intersects(ElementFlags::OPTIONAL) {
                check_flags = CheckFlags::OPTIONAL_PARAMETER;
            }
            let name = self.text(associated_names.get(i).map_or(&[][..], Vec::as_slice));
            let symbol =
                self.new_symbol_ex(SymbolFlags::FUNCTION_SCOPED_VARIABLE, name, check_flags);
            let links = self.value_symbol_links_get(symbol);
            let resolved_type = if flags.intersects(ElementFlags::REST) {
                self.create_array_type(t)
            } else {
                t
            };
            self.value_symbol_links[links].resolved_type = resolved_type;
            expanded.push(symbol);
        }
        self.list_of(&expanded)
    }

    pub fn get_uniq_associated_names_from_tuple_type(
        &mut self,
        t: TypeId,
        rest_symbol: SymbolId,
    ) -> Vec<Vec<u8>> {
        let element_infos = self.type_target_tuple_type(t).element_infos;
        let mut names: Vec<Vec<u8>> = Vec::with_capacity(element_infos.as_slice().len());
        let mut counters: BTreeMap<Vec<u8>, isize> = BTreeMap::new();
        for (i, &info) in element_infos.as_slice().iter().enumerate() {
            let name = self.get_tuple_element_label(info, rest_symbol, i as isize);
            // count duplicates using negative values
            *counters.entry(name.clone()).or_insert(0) -= 1;
            names.push(name);
        }
        for i in 0..names.len() {
            let Some(name) = names.get(i).cloned() else {
                continue;
            };
            if counters.get(&name).copied().unwrap_or(0) == -1 {
                continue;
            }
            loop {
                let counter = counters.entry(name.clone()).or_insert(0);
                if *counter < 0 {
                    // switch to a positive suffix counter
                    *counter = 0;
                }
                *counter += 1;
                let mut candidate_name = name.clone();
                candidate_name.push(b'_');
                candidate_name.extend_from_slice(counter.to_string().as_bytes());
                if counters.get(&candidate_name).copied().unwrap_or(0) == 0 {
                    if let Some(slot) = names.get_mut(i) {
                        *slot = candidate_name;
                    }
                    break;
                }
            }
        }
        names
    }
}

pub fn has_rest_parameter(a: Ast<'_>, signature: NodeId) -> bool {
    let parameters = a.parameters(signature);
    let last = parameters.at(parameters.len() - 1);
    !last.is_nil() && is_rest_parameter(a, last)
}

pub fn is_rest_parameter(a: Ast<'_>, param: NodeId) -> bool {
    !a.as_parameter_declaration(param).dot_dot_dot_token.is_nil()
}

pub fn get_name_from_index_info(c: &Checker<'_>, info: IndexInfoId) -> Vec<u8> {
    let declaration = c.index_infos[info].declaration;
    if !declaration.is_nil() {
        let a = c.ast;
        return declaration_name_to_string(a, a.name(a.parameters(declaration).at(0usize)));
    }
    b"x".to_vec()
}

impl<'a> Checker<'a> {
    pub fn is_unknown_like_union_type(&mut self, t: TypeId) -> bool {
        if self.strict_null_checks && self.types[t].flags.intersects(TypeFlags::UNION) {
            if !self.types[t]
                .object_flags
                .intersects(ObjectFlags::IS_UNKNOWN_LIKE_UNION_COMPUTED)
            {
                self.types[t].object_flags |= ObjectFlags::IS_UNKNOWN_LIKE_UNION_COMPUTED;
                let types = self.type_types(t).as_slice();
                if types.len() >= 3
                    && self.types[at(types, 0)]
                        .flags
                        .intersects(TypeFlags::UNDEFINED)
                    && self.types[at(types, 1)].flags.intersects(TypeFlags::NULL)
                {
                    let mut some_empty = false;
                    for &constituent in types {
                        if self.is_empty_anonymous_object_type(constituent) {
                            some_empty = true;
                            break;
                        }
                    }
                    if some_empty {
                        self.types[t].object_flags |= ObjectFlags::IS_UNKNOWN_LIKE_UNION;
                    }
                }
            }
            return self.types[t]
                .object_flags
                .intersects(ObjectFlags::IS_UNKNOWN_LIKE_UNION);
        }
        false
    }

    // Return true the given type is a primitive union type where no two literal type constituents are comparable. Specifically, that means (a) the union doesn't contain literals from different enum types, and (b) the union doesn't contain both enum literals and string or number literals.
    pub fn is_uniform_union_type(&mut self, t: TypeId) -> bool {
        if self.types[t]
            .object_flags
            .intersects(ObjectFlags::PRIMITIVE_UNION)
        {
            if !self.types[t]
                .object_flags
                .intersects(ObjectFlags::IS_UNIFORM_ENUM_COMPUTED)
            {
                let types = self.type_types(t);
                let is_uniform = self.compute_is_uniform_union_type(types);
                let uniform_flags = if is_uniform {
                    ObjectFlags::IS_UNIFORM_ENUM
                } else {
                    ObjectFlags::NONE
                };
                self.types[t].object_flags |= ObjectFlags::IS_UNIFORM_ENUM_COMPUTED | uniform_flags;
            }
            return self.types[t]
                .object_flags
                .intersects(ObjectFlags::IS_UNIFORM_ENUM);
        }
        false
    }

    pub fn compute_is_uniform_union_type(&mut self, types: List<'_, TypeId>) -> bool {
        let mut enum_symbol = SymbolId::NIL;
        let mut has_string_or_number_literal = false;
        for &t in types.as_slice() {
            if self.types[t].flags.intersects(TypeFlags::ENUM_LIKE) {
                if has_string_or_number_literal {
                    return false;
                }
                let symbol = self.types[t].symbol;
                let parent = self.get_parent_of_symbol(symbol);
                if enum_symbol.is_nil() {
                    enum_symbol = parent;
                } else if enum_symbol != parent {
                    return false;
                }
            } else if self.types[t]
                .flags
                .intersects(TypeFlags::STRING_OR_NUMBER_LITERAL)
            {
                if !enum_symbol.is_nil() {
                    return false;
                }
                has_string_or_number_literal = true;
            }
        }
        true
    }

    pub fn contains_undefined_type(&self, t: TypeId) -> bool {
        let mut t = t;
        if self.types[t].flags.intersects(TypeFlags::UNION) {
            t = at(self.type_types(t).as_slice(), 0);
        }
        self.types[t].flags.intersects(TypeFlags::UNDEFINED)
    }

    pub fn type_has_call_or_construct_signatures(&mut self, t: TypeId) -> bool {
        if !self.types[t].flags.intersects(TypeFlags::STRUCTURED_TYPE) {
            return false;
        }
        let resolved = self.resolve_structured_type_members(t);
        !self
            .as_structured_type(resolved)
            .signatures
            .as_slice()
            .is_empty()
    }

    pub fn get_simplified_type(&mut self, t: TypeId, writing: bool) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            let _: () = self.stack_limit();
            return t;
        }
        let flags = self.types[t].flags;
        if flags.intersects(TypeFlags::INDEXED_ACCESS) {
            return self.get_simplified_indexed_access_type(t, writing);
        }
        if flags.intersects(TypeFlags::CONDITIONAL) {
            return self.get_simplified_conditional_type(t, writing);
        }
        t
    }

    pub fn extract_types_of_kind(&mut self, t: TypeId, kind: TypeFlags) -> TypeId {
        self.filter_type(t, &mut |c, u| c.types[u].flags.intersects(kind))
    }

    pub fn get_regular_type_of_object_literal(&mut self, t: TypeId) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            self.stack_limit::<()>();
            return t;
        }
        if !(is_object_literal_type(self, t)
            && self.types[t]
                .object_flags
                .intersects(ObjectFlags::FRESH_LITERAL))
        {
            return t;
        }
        let key = CachedTypeKey {
            kind: CachedTypeKind::REGULAR_OBJECT_LITERAL,
            type_id: t,
        };
        let cached = self.cached_types.get(&key);
        if !cached.is_nil() {
            return cached;
        }
        let resolved = self.resolve_structured_type_members(t);
        let members = self.transform_type_of_members(t, &mut |c, property_type| {
            c.get_regular_type_of_object_literal(property_type)
        });
        let symbol = self.types[t].symbol;
        let call_signatures = self.as_structured_type(resolved).call_signatures();
        let construct_signatures = self.as_structured_type(resolved).construct_signatures();
        let index_infos = self.as_structured_type(resolved).index_infos;
        let regular = self.new_anonymous_type(
            symbol,
            members,
            call_signatures,
            construct_signatures,
            index_infos,
        );
        let resolved_flags = self.types[resolved].flags;
        self.types[regular].flags = resolved_flags;
        let resolved_object_flags = self.types[resolved]
            .object_flags
            .without(ObjectFlags::FRESH_LITERAL);
        self.types[regular].object_flags |= resolved_object_flags;
        let ok = self.cached_types.set(key, regular);
        self.map_set(ok);
        regular
    }

    pub fn transform_type_of_members(
        &mut self,
        t: TypeId,
        f: &mut dyn FnMut(&mut Checker<'a>, TypeId) -> TypeId,
    ) -> SymbolTable {
        let a = self.ast;
        let members = a.new_table();
        let properties = self.get_properties_of_object_type(t);
        for &property in properties.as_slice() {
            let mut property = property;
            let original = self.get_type_of_symbol(property);
            let updated = f(self, original);
            if updated != original {
                property = self.create_symbol_with_type(property, updated);
            }
            a.table_set(members, a.sym(property).name, property);
        }
        members
    }
}
