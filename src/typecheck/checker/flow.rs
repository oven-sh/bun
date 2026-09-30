// checker/flow.go (layers F-NARROW, F-REACH): the whole file in upstream order, then the narrowing helpers that upstream keeps in checker.go:31594-31692. A flow state is a record of the checker named by its id: the functions that take `f *FlowState` take the id, and a flow node is read by value from the tree context.
use crate::ast::{
    Arg, Ast, CheckFlags, DiagnosticId, Factory, FlowFlags, FlowListId, FlowNodeId,
    FlowSwitchClauseData, INTERNAL_SYMBOL_NAME_PREFIX, Kind, NodeFactory, NodeFlags, NodeId,
    SymbolFlags, SymbolId, find_ancestor, get_root_declaration, get_source_file_of_node,
    get_this_container, has_static_modifier, is_access_expression, is_array_binding_pattern,
    is_array_literal_expression, is_arrow_function, is_assignment_expression, is_assignment_target,
    is_binary_expression, is_binding_element, is_binding_pattern, is_boolean_literal,
    is_call_expression, is_catch_clause, is_class_like, is_element_access_expression,
    is_entity_name_expression, is_enum_member, is_expression_of_optional_chain_root,
    is_expression_statement, is_for_in_statement, is_for_of_statement, is_function_expression,
    is_function_expression_or_arrow_function, is_function_like, is_function_or_module_block,
    is_function_or_source_file, is_identifier, is_in_js_file, is_jsx_opening_element,
    is_jsx_self_closing_element, is_meta_property, is_new_expression, is_non_null_expression,
    is_object_binding_pattern, is_object_literal_method, is_optional_chain,
    is_parameter_declaration, is_parenthesized_expression, is_private_identifier,
    is_property_access_expression, is_property_assignment, is_property_declaration,
    is_property_signature_declaration, is_push_or_unshift_identifier, is_qualified_name,
    is_shorthand_property_assignment, is_static, is_string_literal, is_string_literal_like,
    is_string_or_numeric_literal_like, is_this_in_type_query, is_type_node, is_type_of_expression,
    is_var_const_like, is_variable_declaration, skip_parentheses, try_get_text_of_property_name,
};
use crate::binder::get_symbol_name_for_private_identifier;
use crate::checker::{
    AssignmentKind, AssignmentReducedKey, CacheHashKey, CachedTypeKey, CachedTypeKind, CheckMode,
    Checker, ContextFlags, ExhaustiveState, FlowLoopInfo, FlowLoopKey, FlowState, FlowStateId,
    FlowType, IterationUse, KeyBuilder, LiteralValue, NarrowedTypeKey, NodeCheckFlags, ObjectFlags,
    RelationKind, SharedFlow, SignatureId, SignatureKind, TypeAliasId, TypeFacts, TypeFlags,
    TypeId, TypePredicateId, TypePredicateKind, UnionReduction, contains_type, every_type,
    get_assignment_target_kind, get_binding_element_property_name, get_property_name_from_type,
    get_string_literal_value, has_dot_dot_dot_token, has_only_expression_initializer,
    is_call_chain, is_empty_array_literal, is_fresh_literal_type, is_in_compound_like_assignment,
    is_literal_type, is_neither_unit_type_nor_never, is_non_null_access, is_type_any,
    is_type_usable_as_property_name, is_unit_type, some_type,
};
use crate::core::{List, Text, Tristate, append_if_unique, coalesce, find_index, or_else};
use crate::diagnostics;
use crate::evaluator::any_to_string;
use crate::scanner::get_range_of_token_at_position;
use crate::stringutil::strings;
use std::borrow::Cow;

// `s[i]` as a guarded read: the zero value when the index is outside the slice.
fn at<T: Copy + Default>(items: &[T], index: isize) -> T {
    usize::try_from(index)
        .ok()
        .and_then(|index| items.get(index))
        .copied()
        .unwrap_or_default()
}

// `s[lo:hi]` as a guarded read: the bounds are clamped to the slice.
fn sub<T>(items: &[T], lo: isize, hi: isize) -> &[T] {
    let hi = usize::try_from(hi).unwrap_or(0).min(items.len());
    let lo = usize::try_from(lo).unwrap_or(0).min(hi);
    items.get(lo..hi).unwrap_or(&[])
}

// slices.Index
fn index_of(items: &[NodeId], node: NodeId) -> isize {
    find_index(items, |item| item == node)
}

// strconv.Itoa
fn itoa(value: isize) -> Vec<u8> {
    value.to_string().into_bytes()
}

// `"", false` of a function that returns a name and whether it has one.
fn no_name<'a>() -> (Cow<'a, [u8]>, bool) {
    (Cow::Borrowed(&[]), false)
}

// `FlowType{t: t}`
fn flow_type_of(t: TypeId) -> FlowType {
    FlowType {
        t,
        incomplete: false,
    }
}

// `strings.HasPrefix(name, ast.InternalSymbolNamePrefix+"#")`
fn is_private_identifier_symbol_name(name: &[u8]) -> bool {
    name.strip_prefix(INTERNAL_SYMBOL_NAME_PREFIX)
        .is_some_and(|rest| rest.starts_with(b"#"))
}

// `node.AsSwitchStatement().CaseBlock.AsCaseBlock().Clauses.Nodes`
fn switch_clauses<'a>(a: Ast<'a>, node: NodeId) -> &'a [NodeId] {
    let case_block = a.as_switch_statement(node).case_block;
    a.nodes(a.as_case_block(case_block).clauses).as_slice()
}

// evaluator.AnyToString of the value of a literal type: the text of a string literal type is borrowed.
fn literal_value_to_string<'a>(c: &Checker<'a>, t: TypeId) -> Cow<'a, [u8]> {
    match c.as_literal_type(t).value {
        LiteralValue::String(text) => Cow::Borrowed(text),
        ref value => Cow::Owned(any_to_string(value)),
    }
}

impl FlowType {
    pub fn is_nil(self) -> bool {
        self.t.is_nil()
    }
}

impl<'a> Checker<'a> {
    pub fn new_flow_type(&self, t: TypeId, incomplete: bool) -> FlowType {
        let mut t = t;
        if incomplete && self.types[t].flags.intersects(TypeFlags::NEVER) {
            t = self.silent_never_type;
        }
        FlowType { t, incomplete }
    }

    pub fn get_flow_state(&mut self) -> FlowStateId {
        let mut f = self.free_flow_state;
        if f.is_nil() {
            f = self.flow_states.alloc(FlowState::default());
        }
        self.free_flow_state = self.flow_states[f].next;
        f
    }

    pub fn put_flow_state(&mut self, f: FlowStateId) {
        let next = self.free_flow_state;
        let state = &mut self.flow_states[f];
        // `*f = FlowState{...}`: every field is zero again; the reduce labels keep their capacity.
        state.reference = NodeId::NIL;
        state.declared_type = TypeId::NIL;
        state.initial_type = TypeId::NIL;
        state.flow_container = NodeId::NIL;
        state.ref_key = CacheHashKey::default();
        state.depth = 0;
        state.shared_flow_start = 0;
        state.reduce_labels.clear();
        state.next = next;
        self.free_flow_state = f;
    }
}

pub fn get_flow_node_of_node(a: Ast<'_>, node: NodeId) -> FlowNodeId {
    if a.has_flow_node_data(node) {
        return a.flow_node(node);
    }
    FlowNodeId::NIL
}

impl<'a> Checker<'a> {
    pub fn get_flow_type_of_reference(
        &mut self,
        reference: NodeId,
        declared_type: TypeId,
    ) -> TypeId {
        self.get_flow_type_of_reference_ex(
            reference,
            declared_type,
            declared_type,
            NodeId::NIL,
            FlowNodeId::NIL,
        )
    }

    pub fn get_flow_type_of_reference_ex(
        &mut self,
        reference: NodeId,
        declared_type: TypeId,
        initial_type: TypeId,
        flow_container: NodeId,
        flow_node: FlowNodeId,
    ) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        if self.flow_analysis_disabled {
            return self.error_type;
        }
        let mut flow_node = flow_node;
        if flow_node.is_nil() {
            flow_node = get_flow_node_of_node(a, reference);
            if flow_node.is_nil() {
                return declared_type;
            }
        }
        let f = self.get_flow_state();
        let shared_flow_start = self.shared_flows.len() as isize;
        let state = &mut self.flow_states[f];
        state.reference = reference;
        state.declared_type = declared_type;
        state.initial_type = coalesce(initial_type, declared_type);
        state.flow_container = flow_container;
        state.shared_flow_start = shared_flow_start;
        self.flow_invocation_count = self.flow_invocation_count.wrapping_add(1);
        let evolved_type = self.get_type_at_flow_node(f, flow_node).t;
        let shared_flow_start = self.flow_states[f].shared_flow_start;
        self.shared_flows
            .truncate(usize::try_from(shared_flow_start).unwrap_or(0));
        self.put_flow_state(f);
        // When the reference is 'x' in an 'x.length', 'x.push(value)', 'x.unshift(value)' or x[n] = value' operation, we give type 'any[]' to 'x' instead of using the type determined by control flow analysis such that operations on empty arrays are possible without implicit any errors and new element types can be inferred without type mismatch errors.
        let result_type = if self.types[evolved_type]
            .object_flags
            .intersects(ObjectFlags::EVOLVING_ARRAY)
            && self.is_evolving_array_operation_target(reference)
        {
            self.auto_array_type
        } else {
            self.finalize_evolving_array_type(evolved_type)
        };
        if result_type == self.unreachable_never_type {
            return declared_type;
        }
        if !a.parent(reference).is_nil()
            && is_non_null_expression(a, a.parent(reference))
            && !self.types[result_type].flags.intersects(TypeFlags::NEVER)
        {
            let non_null_type =
                self.get_type_with_facts(result_type, TypeFacts::NE_UNDEFINED_OR_NULL);
            if self.types[non_null_type].flags.intersects(TypeFlags::NEVER) {
                return declared_type;
            }
        }
        result_type
    }

    // The stack test comes before the test of the depth: a thread without stack left records the stack limit and reports no TS2563.
    pub fn get_type_at_flow_node(&mut self, f: FlowStateId, flow: FlowNodeId) -> FlowType {
        if !self.stack_check.is_safe_to_recurse() {
            let _: () = self.stack_limit();
            return flow_type_of(self.error_type);
        }
        let a = self.ast;
        if self.flow_states[f].depth == 2000 {
            // We have made 2000 recursive invocations. To avoid overflowing the call stack we report an error and disable further control flow analysis in the containing function or module body.
            self.flow_analysis_disabled = true;
            let reference = self.flow_states[f].reference;
            self.report_flow_control_error(reference);
            return flow_type_of(self.error_type);
        }
        self.flow_states[f].depth += 1;
        let mut flow = flow;
        let mut shared_flow = FlowNodeId::NIL;
        loop {
            let flow_node = a.flow(flow);
            let flags = flow_node.flags;
            if flags.intersects(FlowFlags::SHARED) {
                // We cache results of flow type resolution for shared nodes that were previously visited in the same getFlowTypeOfReference invocation. A node is considered shared when it is the antecedent of more than one node.
                let start = usize::try_from(self.flow_states[f].shared_flow_start).unwrap_or(0);
                let cached = self
                    .shared_flows
                    .iter()
                    .skip(start)
                    .find(|shared| shared.flow == flow)
                    .map(|shared| shared.flow_type);
                if let Some(flow_type) = cached {
                    self.flow_states[f].depth -= 1;
                    return flow_type;
                }
                shared_flow = flow;
            }
            let t = if flags.intersects(FlowFlags::ASSIGNMENT) {
                let flow_type = self.get_type_at_flow_assignment(f, flow);
                if flow_type.is_nil() {
                    flow = flow_node.antecedent;
                    continue;
                }
                flow_type
            } else if flags.intersects(FlowFlags::CALL) {
                let flow_type = self.get_type_at_flow_call(f, flow);
                if flow_type.is_nil() {
                    flow = flow_node.antecedent;
                    continue;
                }
                flow_type
            } else if flags.intersects(FlowFlags::CONDITION) {
                self.get_type_at_flow_condition(f, flow)
            } else if flags.intersects(FlowFlags::SWITCH_CLAUSE) {
                self.get_type_at_switch_clause(f, flow)
            } else if flags.intersects(FlowFlags::BRANCH_LABEL) {
                let antecedents =
                    get_branch_label_antecedents(a, flow, &self.flow_states[f].reduce_labels);
                let first = a.flow_list(antecedents);
                if first.next.is_nil() {
                    flow = first.flow;
                    continue;
                }
                self.get_type_at_flow_branch_label(f, flow, antecedents)
            } else if flags.intersects(FlowFlags::LOOP_LABEL) {
                let first = a.flow_list(flow_node.antecedents);
                if first.next.is_nil() {
                    flow = first.flow;
                    continue;
                }
                self.get_type_at_flow_loop_label(f, flow)
            } else if flags.intersects(FlowFlags::ARRAY_MUTATION) {
                let flow_type = self.get_type_at_flow_array_mutation(f, flow);
                if flow_type.is_nil() {
                    flow = flow_node.antecedent;
                    continue;
                }
                flow_type
            } else if flags.intersects(FlowFlags::REDUCE_LABEL) {
                self.flow_states[f].reduce_labels.push(flow_node.node);
                let flow_type = self.get_type_at_flow_node(f, flow_node.antecedent);
                self.flow_states[f].reduce_labels.pop();
                flow_type
            } else if flags.intersects(FlowFlags::START) {
                // Check if we should continue with the control flow of the containing function.
                let container = flow_node.node;
                let reference = self.flow_states[f].reference;
                if !container.is_nil()
                    && container != self.flow_states[f].flow_container
                    && !is_property_access_expression(a, reference)
                    && !is_element_access_expression(a, reference)
                    && !(a.kind(reference) == Kind::ThisKeyword && !is_arrow_function(a, container))
                {
                    let container_flow = a.flow_node(container);
                    if !container_flow.is_nil() {
                        flow = container_flow;
                        continue;
                    }
                    // Upstream reads the flags of the flow node of the container without a nil test: the initial type stands, as at the top of the flow.
                    let _: () = self.fail("nil FlowNode of the container in getTypeAtFlowNode");
                }
                // At the top of the flow we have the initial type.
                flow_type_of(self.flow_states[f].initial_type)
            } else {
                // Unreachable code errors are reported in the binding phase. Here we simply return the non-auto declared type to reduce follow-on errors.
                let declared_type = self.flow_states[f].declared_type;
                flow_type_of(self.convert_auto_to_any(declared_type))
            };
            if !shared_flow.is_nil() {
                // Record visited node and the associated type in the cache.
                self.shared_flows.push(SharedFlow {
                    flow: shared_flow,
                    flow_type: t,
                });
            }
            self.flow_states[f].depth -= 1;
            return t;
        }
    }
}

// The reduce labels are the FlowReduceLabelData nodes in force, the innermost last.
pub fn get_branch_label_antecedents(
    a: Ast<'_>,
    flow: FlowNodeId,
    reduce_labels: &[NodeId],
) -> FlowListId {
    for &label in reduce_labels.iter().rev() {
        let data = a.as_flow_reduce_label_data(label);
        if data.target == flow {
            return data.antecedents;
        }
    }
    a.flow(flow).antecedents
}

impl<'a> Checker<'a> {
    pub fn get_type_at_flow_assignment(&mut self, f: FlowStateId, flow: FlowNodeId) -> FlowType {
        let a = self.ast;
        let flow_node = a.flow(flow);
        let node = flow_node.node;
        let reference = self.flow_states[f].reference;
        let declared_type = self.flow_states[f].declared_type;
        // Assignments only narrow the computed type if the declared type is a union type. Thus, we only need to evaluate the assigned type if the declared type is a union type.
        if self.is_matching_reference(reference, node) {
            if !self.is_reachable_flow_node(flow) {
                return flow_type_of(self.unreachable_never_type);
            }
            if get_assignment_target_kind(a, node) == AssignmentKind::COMPOUND {
                let flow_type = self.get_type_at_flow_node(f, flow_node.antecedent);
                let base_type = self.get_base_type_of_literal_type(flow_type.t);
                return self.new_flow_type(base_type, flow_type.incomplete);
            }
            if declared_type == self.auto_type || declared_type == self.auto_array_type {
                if self.is_empty_array_assignment(node) {
                    return flow_type_of(self.get_evolving_array_type(self.never_type));
                }
                let initial_or_assigned_type = self.get_initial_or_assigned_type(f, flow);
                let assigned_type = self.get_widened_literal_type(initial_or_assigned_type);
                if self.is_type_assignable_to(assigned_type, declared_type) {
                    return flow_type_of(assigned_type);
                }
                return flow_type_of(self.any_array_type);
            }
            let mut t = declared_type;
            if is_in_compound_like_assignment(a, node) {
                t = self.get_base_type_of_literal_type(t);
            }
            if self.types[t].flags.intersects(TypeFlags::UNION) {
                let assigned_type = self.get_initial_or_assigned_type(f, flow);
                return flow_type_of(self.get_assignment_reduced_type(t, assigned_type));
            }
            return flow_type_of(t);
        }
        // We didn't have a direct match. However, if the reference is a dotted name, this may be an assignment to a left hand part of the reference. For example, for a reference 'x.y.z', we may be at an assignment to 'x.y' or 'x'. In that case, return the declared type.
        if self.contains_matching_reference(reference, node) {
            if !self.is_reachable_flow_node(flow) {
                return flow_type_of(self.unreachable_never_type);
            }
            // A matching dotted name might also be an expando property on a function *expression*, in which case we continue control flow analysis back to the function's declaration
            if is_variable_declaration(a, node)
                && (is_in_js_file(a, node) || is_var_const_like(a, node))
            {
                let init = a.initializer(node);
                if !init.is_nil() && is_function_expression_or_arrow_function(a, init) {
                    return self.get_type_at_flow_node(f, flow_node.antecedent);
                }
            }
            return flow_type_of(declared_type);
        }
        // for (const _ in ref) acts as a nonnull on ref
        if is_variable_declaration(a, node) && is_for_in_statement(a, a.parent(a.parent(node))) {
            let expression = a.expression(a.parent(a.parent(node)));
            if self.is_matching_reference(reference, expression)
                || self.optional_chain_contains_reference(expression, reference)
            {
                let antecedent_type = self.get_type_at_flow_node(f, flow_node.antecedent).t;
                let finalized_type = self.finalize_evolving_array_type(antecedent_type);
                return flow_type_of(self.get_non_nullable_type_if_needed(finalized_type));
            }
        }
        // Assignment doesn't affect reference
        flow_type_of(TypeId::NIL)
    }

    pub fn get_initial_or_assigned_type(&mut self, f: FlowStateId, flow: FlowNodeId) -> TypeId {
        let a = self.ast;
        let node = a.flow(flow).node;
        if is_variable_declaration(a, node) || is_binding_element(a, node) {
            let initial_type = self.get_initial_type(node);
            let reference = self.flow_states[f].reference;
            return self.get_narrowable_type_for_reference(
                initial_type,
                reference,
                CheckMode::NORMAL,
            );
        }
        let assigned_type = self.get_assigned_type(node);
        let reference = self.flow_states[f].reference;
        self.get_narrowable_type_for_reference(assigned_type, reference, CheckMode::NORMAL)
    }

    pub fn is_empty_array_assignment(&self, node: NodeId) -> bool {
        let a = self.ast;
        is_variable_declaration(a, node)
            && !a.initializer(node).is_nil()
            && is_empty_array_literal(a, a.initializer(node))
            || !is_binding_element(a, node)
                && is_binary_expression(a, a.parent(node))
                && is_empty_array_literal(a, a.as_binary_expression(a.parent(node)).right)
    }

    pub fn get_type_at_flow_call(&mut self, f: FlowStateId, flow: FlowNodeId) -> FlowType {
        let a = self.ast;
        let flow_node = a.flow(flow);
        let signature = self.get_effects_signature(flow_node.node);
        if !signature.is_nil() {
            let predicate = self.get_type_predicate_of_signature(signature);
            if !predicate.is_nil()
                && (self.type_predicates[predicate].kind == TypePredicateKind::ASSERTS_THIS
                    || self.type_predicates[predicate].kind
                        == TypePredicateKind::ASSERTS_IDENTIFIER)
            {
                let flow_type = self.get_type_at_flow_node(f, flow_node.antecedent);
                let t = self.finalize_evolving_array_type(flow_type.t);
                let predicate_kind = self.type_predicates[predicate].kind;
                let parameter_index = self.type_predicates[predicate].parameter_index as isize;
                let narrowed_type = if !self.type_predicates[predicate].t.is_nil() {
                    self.narrow_type_by_type_predicate(f, t, predicate, flow_node.node, true)
                } else if predicate_kind == TypePredicateKind::ASSERTS_IDENTIFIER
                    && parameter_index >= 0
                    && parameter_index < a.arguments(flow_node.node).len()
                {
                    let argument = a.arguments(flow_node.node).at(parameter_index);
                    self.narrow_type_by_assertion(f, t, argument)
                } else {
                    t
                };
                if narrowed_type == t {
                    return flow_type;
                }
                return self.new_flow_type(narrowed_type, flow_type.incomplete);
            }
            let return_type = self.get_return_type_of_signature(signature);
            if self.types[return_type].flags.intersects(TypeFlags::NEVER) {
                return flow_type_of(self.unreachable_never_type);
            }
        }
        flow_type_of(TypeId::NIL)
    }

    pub fn narrow_type_by_type_predicate(
        &mut self,
        f: FlowStateId,
        t: TypeId,
        predicate: TypePredicateId,
        call_expression: NodeId,
        assume_true: bool,
    ) -> TypeId {
        let mut t = t;
        let predicate_type = self.type_predicates[predicate].t;
        // Don't narrow from 'any' if the predicate type is exactly 'Object' or 'Function'
        if !predicate_type.is_nil()
            && !(is_type_any(self, t)
                && (predicate_type == self.global_object_type
                    || predicate_type == self.global_function_type))
        {
            let predicate_argument = self.get_type_predicate_argument(predicate, call_expression);
            if !predicate_argument.is_nil() {
                let reference = self.flow_states[f].reference;
                if self.is_matching_reference(reference, predicate_argument) {
                    return self.get_narrowed_type(t, predicate_type, assume_true, false);
                }
                if self.strict_null_checks
                    && self.optional_chain_contains_reference(predicate_argument, reference)
                    && (assume_true
                        && !self.has_type_facts(predicate_type, TypeFacts::EQ_UNDEFINED)
                        || !assume_true
                            && every_type(self, predicate_type, &mut |c, t| c.is_nullable_type(t)))
                {
                    t = self.get_adjusted_type_with_facts(t, TypeFacts::NE_UNDEFINED_OR_NULL);
                }
                let access = self.get_discriminant_property_access(f, predicate_argument, t);
                if !access.is_nil() {
                    return self.narrow_type_by_discriminant(t, access, &mut |c, t| {
                        c.get_narrowed_type(t, predicate_type, assume_true, false)
                    });
                }
            }
        }
        t
    }

    pub fn narrow_type_by_assertion(&mut self, f: FlowStateId, t: TypeId, expr: NodeId) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        let node = skip_parentheses(a, expr);
        if a.kind(node) == Kind::FalseKeyword {
            return self.unreachable_never_type;
        }
        if a.kind(node) == Kind::BinaryExpression {
            let binary = a.as_binary_expression(node);
            if a.kind(binary.operator_token) == Kind::AmpersandAmpersandToken {
                let left_type = self.narrow_type_by_assertion(f, t, binary.left);
                return self.narrow_type_by_assertion(f, left_type, binary.right);
            }
            if a.kind(binary.operator_token) == Kind::BarBarToken {
                let left_type = self.narrow_type_by_assertion(f, t, binary.left);
                let right_type = self.narrow_type_by_assertion(f, t, binary.right);
                return self.get_union_type(List::from_slice(&[left_type, right_type]));
            }
        }
        self.narrow_type(f, t, node, true)
    }

    pub fn get_type_at_flow_condition(&mut self, f: FlowStateId, flow: FlowNodeId) -> FlowType {
        let a = self.ast;
        let flow_node = a.flow(flow);
        let flow_type = self.get_type_at_flow_node(f, flow_node.antecedent);
        if self.types[flow_type.t].flags.intersects(TypeFlags::NEVER) {
            return flow_type;
        }
        // If we have an antecedent type (meaning we're reachable in some way), we first attempt to narrow the antecedent type. If that produces the never type, and if the antecedent type is incomplete (i.e. a transient type in a loop), then we take the type guard as an indication that control *could* reach here once we have the complete type. We proceed by switching to the silent never type which doesn't report errors when operators are applied to it. Note that this is the *only* place a silent never type is ever generated.
        let assume_true = flow_node.flags.intersects(FlowFlags::TRUE_CONDITION);
        let non_evolving_type = self.finalize_evolving_array_type(flow_type.t);
        let narrowed_type = self.narrow_type(f, non_evolving_type, flow_node.node, assume_true);
        if narrowed_type == non_evolving_type {
            return flow_type;
        }
        self.new_flow_type(narrowed_type, flow_type.incomplete)
    }

    // Narrow the given type based on the given expression having the assumed boolean value. The returned type will be a subtype or the same type as the argument.
    pub fn narrow_type(
        &mut self,
        f: FlowStateId,
        t: TypeId,
        expr: NodeId,
        assume_true: bool,
    ) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        let parent = a.parent(expr);
        // for `a?.b`, we emulate a synthetic `a !== null && a !== undefined` condition for `a`
        if is_expression_of_optional_chain_root(a, expr)
            || is_binary_expression(a, parent)
                && (a.kind(a.as_binary_expression(parent).operator_token)
                    == Kind::QuestionQuestionToken
                    || a.kind(a.as_binary_expression(parent).operator_token)
                        == Kind::QuestionQuestionEqualsToken)
                && a.as_binary_expression(parent).left == expr
        {
            return self.narrow_type_by_optionality(f, t, expr, assume_true);
        }
        match a.kind(expr) {
            Kind::Identifier
            | Kind::ThisKeyword
            | Kind::SuperKeyword
            | Kind::PropertyAccessExpression
            | Kind::ElementAccessExpression => {
                if a.kind(expr) == Kind::Identifier {
                    // When narrowing a reference to a const variable, non-assigned parameter, or readonly property, we inline up to five levels of aliased conditional expressions that are themselves declared as const variables.
                    let reference = self.flow_states[f].reference;
                    if !self.is_matching_reference(reference, expr) && self.inline_level < 5 {
                        let symbol = self.get_resolved_symbol(expr);
                        if self.is_constant_variable(symbol) {
                            let declaration = a.sym(symbol).value_declaration;
                            if !declaration.is_nil()
                                && is_variable_declaration(a, declaration)
                                && a.type_node(declaration).is_nil()
                                && !a.initializer(declaration).is_nil()
                                && self.is_constant_reference(reference)
                            {
                                self.inline_level += 1;
                                let result =
                                    self.narrow_type(f, t, a.initializer(declaration), assume_true);
                                self.inline_level -= 1;
                                return result;
                            }
                        }
                    }
                }
                self.narrow_type_by_truthiness(f, t, expr, assume_true)
            }
            Kind::CallExpression => self.narrow_type_by_call_expression(f, t, expr, assume_true),
            Kind::ParenthesizedExpression | Kind::NonNullExpression | Kind::SatisfiesExpression => {
                self.narrow_type(f, t, a.expression(expr), assume_true)
            }
            Kind::BinaryExpression => {
                self.narrow_type_by_binary_expression(f, t, expr, assume_true)
            }
            Kind::PrefixUnaryExpression => {
                let prefix = a.as_prefix_unary_expression(expr);
                if prefix.operator == Kind::ExclamationToken {
                    return self.narrow_type(f, t, prefix.operand, !assume_true);
                }
                t
            }
            _ => t,
        }
    }

    pub fn narrow_type_by_optionality(
        &mut self,
        f: FlowStateId,
        t: TypeId,
        expr: NodeId,
        assume_present: bool,
    ) -> TypeId {
        let facts = if assume_present {
            TypeFacts::NE_UNDEFINED_OR_NULL
        } else {
            TypeFacts::EQ_UNDEFINED_OR_NULL
        };
        let reference = self.flow_states[f].reference;
        if self.is_matching_reference(reference, expr) {
            return self.get_adjusted_type_with_facts(t, facts);
        }
        let access = self.get_discriminant_property_access(f, expr, t);
        if !access.is_nil() {
            return self.narrow_type_by_discriminant(t, access, &mut |c, t| {
                c.get_type_with_facts(t, facts)
            });
        }
        t
    }

    pub fn narrow_type_by_truthiness(
        &mut self,
        f: FlowStateId,
        t: TypeId,
        expr: NodeId,
        assume_true: bool,
    ) -> TypeId {
        let mut t = t;
        let facts = if assume_true {
            TypeFacts::TRUTHY
        } else {
            TypeFacts::FALSY
        };
        let reference = self.flow_states[f].reference;
        if self.is_matching_reference(reference, expr) {
            return self.get_adjusted_type_with_facts(t, facts);
        }
        if self.strict_null_checks
            && assume_true
            && self.optional_chain_contains_reference(expr, reference)
        {
            t = self.get_adjusted_type_with_facts(t, TypeFacts::NE_UNDEFINED_OR_NULL);
        }
        let access = self.get_discriminant_property_access(f, expr, t);
        if !access.is_nil() {
            return self.narrow_type_by_discriminant(t, access, &mut |c, t| {
                c.get_type_with_facts(t, facts)
            });
        }
        t
    }

    pub fn narrow_type_by_call_expression(
        &mut self,
        f: FlowStateId,
        t: TypeId,
        call_expression: NodeId,
        assume_true: bool,
    ) -> TypeId {
        let a = self.ast;
        let reference = self.flow_states[f].reference;
        if self.has_matching_argument(call_expression, reference) {
            let mut predicate = TypePredicateId::NIL;
            if assume_true || !is_call_chain(a, call_expression) {
                let signature = self.get_effects_signature(call_expression);
                if !signature.is_nil() {
                    predicate = self.get_type_predicate_of_signature(signature);
                }
            }
            if !predicate.is_nil()
                && (self.type_predicates[predicate].kind == TypePredicateKind::THIS
                    || self.type_predicates[predicate].kind == TypePredicateKind::IDENTIFIER)
            {
                return self.narrow_type_by_type_predicate(
                    f,
                    t,
                    predicate,
                    call_expression,
                    assume_true,
                );
            }
        }
        if self.contains_missing_type(t)
            && is_access_expression(a, reference)
            && is_property_access_expression(a, a.expression(call_expression))
        {
            let call_access = a.expression(call_expression);
            let candidate = self.get_reference_candidate(a.expression(call_access));
            if self.is_matching_reference(a.expression(reference), candidate)
                && is_identifier(a, a.name(call_access))
                && a.text(a.name(call_access)) == b"hasOwnProperty"
                && a.arguments(call_expression).len() == 1
            {
                let argument = a.arguments(call_expression).at(0usize);
                let (accessed_name, ok) = self.get_accessed_property_name(reference);
                if ok && is_string_literal_like(a, argument) && *accessed_name == *a.text(argument)
                {
                    let facts = if assume_true {
                        TypeFacts::NE_UNDEFINED
                    } else {
                        TypeFacts::EQ_UNDEFINED
                    };
                    return self.get_type_with_facts(t, facts);
                }
            }
        }
        t
    }

    // Upstream takes the `*ast.BinaryExpression`: here `expr` is the node of the binary expression.
    pub fn narrow_type_by_binary_expression(
        &mut self,
        f: FlowStateId,
        t: TypeId,
        expr: NodeId,
        assume_true: bool,
    ) -> TypeId {
        let a = self.ast;
        let mut t = t;
        let binary = a.as_binary_expression(expr);
        let reference = self.flow_states[f].reference;
        match a.kind(binary.operator_token) {
            Kind::EqualsToken
            | Kind::BarBarEqualsToken
            | Kind::AmpersandAmpersandEqualsToken
            | Kind::QuestionQuestionEqualsToken => {
                let right_type = self.narrow_type(f, t, binary.right, assume_true);
                return self.narrow_type_by_truthiness(f, right_type, binary.left, assume_true);
            }
            Kind::EqualsEqualsToken
            | Kind::ExclamationEqualsToken
            | Kind::EqualsEqualsEqualsToken
            | Kind::ExclamationEqualsEqualsToken => {
                let operator = a.kind(binary.operator_token);
                let left = self.get_reference_candidate(binary.left);
                let right = self.get_reference_candidate(binary.right);
                if a.kind(left) == Kind::TypeOfExpression && is_string_literal_like(a, right) {
                    return self.narrow_type_by_typeof(f, t, left, operator, right, assume_true);
                }
                if a.kind(right) == Kind::TypeOfExpression && is_string_literal_like(a, left) {
                    return self.narrow_type_by_typeof(f, t, right, operator, left, assume_true);
                }
                if self.is_matching_reference(reference, left) {
                    return self.narrow_type_by_equality(t, operator, right, assume_true);
                }
                if self.is_matching_reference(reference, right) {
                    return self.narrow_type_by_equality(t, operator, left, assume_true);
                }
                if self.strict_null_checks {
                    if self.optional_chain_contains_reference(left, reference) {
                        t = self.narrow_type_by_optional_chain_containment(
                            f,
                            t,
                            operator,
                            right,
                            assume_true,
                        );
                    } else if self.optional_chain_contains_reference(right, reference) {
                        t = self.narrow_type_by_optional_chain_containment(
                            f,
                            t,
                            operator,
                            left,
                            assume_true,
                        );
                    }
                }
                let left_access = self.get_discriminant_property_access(f, left, t);
                if !left_access.is_nil() {
                    return self.narrow_type_by_discriminant_property(
                        t,
                        left_access,
                        operator,
                        right,
                        assume_true,
                    );
                }
                let right_access = self.get_discriminant_property_access(f, right, t);
                if !right_access.is_nil() {
                    return self.narrow_type_by_discriminant_property(
                        t,
                        right_access,
                        operator,
                        left,
                        assume_true,
                    );
                }
                if self.is_matching_constructor_reference(f, left) {
                    return self.narrow_type_by_constructor(t, operator, right, assume_true);
                }
                if self.is_matching_constructor_reference(f, right) {
                    return self.narrow_type_by_constructor(t, operator, left, assume_true);
                }
                if is_boolean_literal(a, right) && !is_access_expression(a, left) {
                    return self.narrow_type_by_boolean_comparison(
                        f,
                        t,
                        left,
                        right,
                        operator,
                        assume_true,
                    );
                }
                if is_boolean_literal(a, left) && !is_access_expression(a, right) {
                    return self.narrow_type_by_boolean_comparison(
                        f,
                        t,
                        right,
                        left,
                        operator,
                        assume_true,
                    );
                }
            }
            Kind::InstanceOfKeyword => {
                return self.narrow_type_by_instanceof(f, t, expr, assume_true);
            }
            Kind::InKeyword => {
                if is_private_identifier(a, binary.left) {
                    return self.narrow_type_by_private_identifier_in_in_expression(
                        f,
                        t,
                        expr,
                        assume_true,
                    );
                }
                let target = self.get_reference_candidate(binary.right);
                if self.contains_missing_type(t)
                    && is_access_expression(a, reference)
                    && self.is_matching_reference(a.expression(reference), target)
                {
                    let left_type = self.get_type_of_expression(binary.left);
                    if is_type_usable_as_property_name(self, left_type) {
                        let (accessed_name, ok) = self.get_accessed_property_name(reference);
                        if ok {
                            let name = get_property_name_from_type(self, left_type);
                            if *accessed_name == *name {
                                let facts = if assume_true {
                                    TypeFacts::NE_UNDEFINED
                                } else {
                                    TypeFacts::EQ_UNDEFINED
                                };
                                return self.get_type_with_facts(t, facts);
                            }
                        }
                    }
                }
                if self.is_matching_reference(reference, target) {
                    let left_type = self.get_type_of_expression(binary.left);
                    if is_type_usable_as_property_name(self, left_type) {
                        return self.narrow_type_by_in_keyword(f, t, left_type, assume_true);
                    }
                }
            }
            Kind::CommaToken => {
                return self.narrow_type(f, t, binary.right, assume_true);
            }
            Kind::AmpersandAmpersandToken => {
                // Ordinarily we won't see && and || expressions in control flow analysis because the Binder breaks those expressions down to individual conditional control flows. However, we may encounter them when analyzing aliased conditional expressions.
                if assume_true {
                    let left_type = self.narrow_type(f, t, binary.left, true);
                    return self.narrow_type(f, left_type, binary.right, true);
                }
                let left_type = self.narrow_type(f, t, binary.left, false);
                let right_type = self.narrow_type(f, t, binary.right, false);
                return self.get_union_type(List::from_slice(&[left_type, right_type]));
            }
            Kind::BarBarToken => {
                if assume_true {
                    let left_type = self.narrow_type(f, t, binary.left, true);
                    let right_type = self.narrow_type(f, t, binary.right, true);
                    return self.get_union_type(List::from_slice(&[left_type, right_type]));
                }
                let left_type = self.narrow_type(f, t, binary.left, false);
                return self.narrow_type(f, left_type, binary.right, false);
            }
            _ => {}
        }
        t
    }

    pub fn narrow_type_by_equality(
        &mut self,
        t: TypeId,
        operator: Kind,
        value: NodeId,
        assume_true: bool,
    ) -> TypeId {
        let mut assume_true = assume_true;
        if self.types[t].flags.intersects(TypeFlags::ANY) {
            return t;
        }
        if operator == Kind::ExclamationEqualsToken
            || operator == Kind::ExclamationEqualsEqualsToken
        {
            assume_true = !assume_true;
        }
        let value_type = self.get_type_of_expression(value);
        let double_equals =
            operator == Kind::EqualsEqualsToken || operator == Kind::ExclamationEqualsToken;
        let value_flags = self.types[value_type].flags;
        if value_flags.intersects(TypeFlags::NULLABLE) {
            if !self.strict_null_checks {
                return t;
            }
            let facts = if double_equals {
                if assume_true {
                    TypeFacts::EQ_UNDEFINED_OR_NULL
                } else {
                    TypeFacts::NE_UNDEFINED_OR_NULL
                }
            } else if value_flags.intersects(TypeFlags::NULL) {
                if assume_true {
                    TypeFacts::EQ_NULL
                } else {
                    TypeFacts::NE_NULL
                }
            } else if assume_true {
                TypeFacts::EQ_UNDEFINED
            } else {
                TypeFacts::NE_UNDEFINED
            };
            return self.get_adjusted_type_with_facts(t, facts);
        }
        if assume_true {
            if !double_equals
                && (self.types[t].flags.intersects(TypeFlags::UNKNOWN)
                    || some_type(self, t, &mut |c, t| c.is_empty_anonymous_object_type(t)))
            {
                if value_flags.intersects(TypeFlags::PRIMITIVE | TypeFlags::NON_PRIMITIVE)
                    || self.is_empty_anonymous_object_type(value_type)
                {
                    return value_type;
                }
                if value_flags.intersects(TypeFlags::OBJECT) {
                    return self.non_primitive_type;
                }
            }
            if !double_equals
                && value_flags.intersects(TypeFlags::PRIMITIVE)
                && self.is_uniform_union_type(t)
            {
                let regular_type = self.get_regular_type_of_literal_type(value_type);
                if self.union_contains_type(t, regular_type, false) {
                    return regular_type;
                }
            }
            let filtered_type = self.filter_type(t, &mut |c, t| {
                c.are_types_comparable(t, value_type)
                    || double_equals && is_coercible_under_double_equals(c, t, value_type)
            });
            return self.replace_primitives_with_literals(filtered_type, value_type);
        }
        if is_unit_type(self, value_type) {
            if self.is_uniform_union_type(t) {
                let regular_type = self.get_regular_type_of_literal_type(value_type);
                let filtered_type = self.remove_type(t, regular_type);
                if filtered_type != t {
                    return filtered_type;
                }
            }
            return self.filter_type(t, &mut |c, t| {
                !(c.is_unit_like_type(t) && c.are_types_comparable(t, value_type))
            });
        }
        t
    }

    // Upstream takes the `*ast.TypeOfExpression`: here `type_of_expr` is the node of the typeof expression.
    pub fn narrow_type_by_typeof(
        &mut self,
        f: FlowStateId,
        t: TypeId,
        type_of_expr: NodeId,
        operator: Kind,
        literal: NodeId,
        assume_true: bool,
    ) -> TypeId {
        let a = self.ast;
        let mut t = t;
        let mut assume_true = assume_true;
        // We have '==', '!=', '===', or !==' operator with 'typeof xxx' and string literal operands
        if operator == Kind::ExclamationEqualsToken
            || operator == Kind::ExclamationEqualsEqualsToken
        {
            assume_true = !assume_true;
        }
        let target = self.get_reference_candidate(a.as_type_of_expression(type_of_expr).expression);
        let reference = self.flow_states[f].reference;
        if !self.is_matching_reference(reference, target) {
            if self.strict_null_checks
                && self.optional_chain_contains_reference(target, reference)
                && assume_true == (a.text(literal) != b"undefined")
            {
                t = self.get_adjusted_type_with_facts(t, TypeFacts::NE_UNDEFINED_OR_NULL);
            }
            let property_access = self.get_discriminant_property_access(f, target, t);
            if !property_access.is_nil() {
                return self.narrow_type_by_discriminant(t, property_access, &mut |c, t| {
                    c.narrow_type_by_literal_expression(t, literal, assume_true)
                });
            }
            return t;
        }
        self.narrow_type_by_literal_expression(t, literal, assume_true)
    }
}

// typeofNEFacts is a Go map: the entries are kept in ascending order of their keys, the order in which checker.go:1058 makes the union of the typeof strings (slices.Sorted(maps.Keys(typeofNEFacts))).
pub const TYPEOF_NE_FACTS: [(&[u8], TypeFacts); 8] = [
    (b"bigint", TypeFacts::TYPEOF_NE_BIG_INT),
    (b"boolean", TypeFacts::TYPEOF_NE_BOOLEAN),
    (b"function", TypeFacts::TYPEOF_NE_FUNCTION),
    (b"number", TypeFacts::TYPEOF_NE_NUMBER),
    (b"object", TypeFacts::TYPEOF_NE_OBJECT),
    (b"string", TypeFacts::TYPEOF_NE_STRING),
    (b"symbol", TypeFacts::TYPEOF_NE_SYMBOL),
    (b"undefined", TypeFacts::NE_UNDEFINED),
];

// `facts, ok := typeofNEFacts[text]`
pub fn typeof_ne_facts(text: &[u8]) -> Option<TypeFacts> {
    for (name, facts) in TYPEOF_NE_FACTS {
        if name == text {
            return Some(facts);
        }
    }
    None
}

impl<'a> Checker<'a> {
    pub fn narrow_type_by_literal_expression(
        &mut self,
        t: TypeId,
        literal: NodeId,
        assume_true: bool,
    ) -> TypeId {
        let a = self.ast;
        if assume_true {
            return self.narrow_type_by_type_name(t, a.text(literal));
        }
        let facts = typeof_ne_facts(a.text(literal)).unwrap_or(TypeFacts::TYPEOF_NE_HOST_OBJECT);
        self.get_adjusted_type_with_facts(t, facts)
    }

    pub fn narrow_type_by_type_name(&mut self, t: TypeId, type_name: &[u8]) -> TypeId {
        match type_name {
            b"string" => {
                return self.narrow_type_by_type_facts(
                    t,
                    self.string_type,
                    TypeFacts::TYPEOF_EQ_STRING,
                );
            }
            b"number" => {
                return self.narrow_type_by_type_facts(
                    t,
                    self.number_type,
                    TypeFacts::TYPEOF_EQ_NUMBER,
                );
            }
            b"bigint" => {
                return self.narrow_type_by_type_facts(
                    t,
                    self.bigint_type,
                    TypeFacts::TYPEOF_EQ_BIG_INT,
                );
            }
            b"boolean" => {
                return self.narrow_type_by_type_facts(
                    t,
                    self.boolean_type,
                    TypeFacts::TYPEOF_EQ_BOOLEAN,
                );
            }
            b"symbol" => {
                return self.narrow_type_by_type_facts(
                    t,
                    self.es_symbol_type,
                    TypeFacts::TYPEOF_EQ_SYMBOL,
                );
            }
            b"object" => {
                if self.types[t].flags.intersects(TypeFlags::ANY) {
                    return t;
                }
                let object_type = self.narrow_type_by_type_facts(
                    t,
                    self.non_primitive_type,
                    TypeFacts::TYPEOF_EQ_OBJECT,
                );
                let null_type =
                    self.narrow_type_by_type_facts(t, self.null_type, TypeFacts::EQ_NULL);
                return self.get_union_type(List::from_slice(&[object_type, null_type]));
            }
            b"function" => {
                if self.types[t].flags.intersects(TypeFlags::ANY) {
                    return t;
                }
                return self.narrow_type_by_type_facts(
                    t,
                    self.global_function_type,
                    TypeFacts::TYPEOF_EQ_FUNCTION,
                );
            }
            b"undefined" => {
                return self.narrow_type_by_type_facts(
                    t,
                    self.undefined_type,
                    TypeFacts::EQ_UNDEFINED,
                );
            }
            _ => {}
        }
        self.narrow_type_by_type_facts(t, self.non_primitive_type, TypeFacts::TYPEOF_EQ_HOST_OBJECT)
    }

    pub fn narrow_type_by_type_facts(
        &mut self,
        t: TypeId,
        implied_type: TypeId,
        facts: TypeFacts,
    ) -> TypeId {
        self.map_type(t, &mut |c, t| {
            if c.is_type_related_to(t, implied_type, RelationKind::StrictSubtype) {
                if c.has_type_facts(t, facts) {
                    return t;
                }
                return c.never_type;
            }
            if c.is_type_subtype_of(implied_type, t) {
                return implied_type;
            }
            if c.has_type_facts(t, facts) {
                return c.get_intersection_type(List::from_slice(&[t, implied_type]));
            }
            c.never_type
        })
    }

    pub fn narrow_type_by_discriminant_property(
        &mut self,
        t: TypeId,
        access: NodeId,
        operator: Kind,
        value: NodeId,
        assume_true: bool,
    ) -> TypeId {
        if (operator == Kind::EqualsEqualsEqualsToken
            || operator == Kind::ExclamationEqualsEqualsToken)
            && self.types[t].flags.intersects(TypeFlags::UNION)
        {
            let key_property_name = self.get_key_property_name(t);
            if !key_property_name.is_empty() {
                let (accessed_name, ok) = self.get_accessed_property_name(access);
                if ok && *key_property_name == *accessed_name {
                    let value_type = self.get_type_of_expression(value);
                    let candidate = self.get_constituent_type_for_key_type(t, value_type);
                    if !candidate.is_nil() {
                        if assume_true && operator == Kind::EqualsEqualsEqualsToken
                            || !assume_true && operator == Kind::ExclamationEqualsEqualsToken
                        {
                            return candidate;
                        }
                        let prop_type =
                            self.get_type_of_property_of_type(candidate, key_property_name);
                        if !prop_type.is_nil() && is_unit_type(self, prop_type) {
                            return self.remove_type(t, candidate);
                        }
                        return t;
                    }
                }
            }
        }
        self.narrow_type_by_discriminant(t, access, &mut |c, t| {
            c.narrow_type_by_equality(t, operator, value, assume_true)
        })
    }

    pub fn narrow_type_by_discriminant(
        &mut self,
        t: TypeId,
        access: NodeId,
        narrow_type: &mut dyn FnMut(&mut Checker<'a>, TypeId) -> TypeId,
    ) -> TypeId {
        let a = self.ast;
        let (prop_name, ok) = self.get_accessed_property_name(access);
        if !ok {
            return t;
        }
        let prop_name: &[u8] = &prop_name;
        let optional_chain = is_optional_chain(a, access);
        let remove_nullable = self.strict_null_checks
            && (optional_chain || is_non_null_access(a, access))
            && self.maybe_type_of_kind(t, TypeFlags::NULLABLE);
        let mut non_null_type = t;
        if remove_nullable {
            non_null_type = self.get_type_with_facts(t, TypeFacts::NE_UNDEFINED_OR_NULL);
        }
        let mut prop_type = self.get_type_of_property_of_type(non_null_type, prop_name);
        if prop_type.is_nil() {
            return t;
        }
        if remove_nullable && optional_chain {
            prop_type = self.get_optional_type(prop_type, false);
        }
        let narrowed_prop_type = narrow_type(self, prop_type);
        self.filter_type(t, &mut |c, t| {
            let discriminant_type = or_else(
                c.get_type_of_property_or_index_signature_of_type(t, prop_name),
                c.unknown_type,
            );
            !c.types[discriminant_type]
                .flags
                .intersects(TypeFlags::NEVER)
                && !c.types[narrowed_prop_type]
                    .flags
                    .intersects(TypeFlags::NEVER)
                && c.are_types_comparable(narrowed_prop_type, discriminant_type)
        })
    }

    pub fn is_matching_constructor_reference(&mut self, f: FlowStateId, expr: NodeId) -> bool {
        let a = self.ast;
        let mut name = NodeId::NIL;
        if is_property_access_expression(a, expr) {
            name = a.as_property_access_expression(expr).name;
        } else if is_element_access_expression(a, expr)
            && is_string_literal_like(a, a.as_element_access_expression(expr).argument_expression)
        {
            name = a.as_element_access_expression(expr).argument_expression;
        }
        let reference = self.flow_states[f].reference;
        !name.is_nil()
            && a.text(name) == b"constructor"
            && self.is_matching_reference(reference, a.expression(expr))
    }

    pub fn narrow_type_by_constructor(
        &mut self,
        t: TypeId,
        operator: Kind,
        identifier: NodeId,
        assume_true: bool,
    ) -> TypeId {
        // Do not narrow when checking inequality.
        if assume_true
            && operator != Kind::EqualsEqualsToken
            && operator != Kind::EqualsEqualsEqualsToken
            || !assume_true
                && operator != Kind::ExclamationEqualsToken
                && operator != Kind::ExclamationEqualsEqualsToken
        {
            return t;
        }
        // Get the type of the constructor identifier expression, if it is not a function then do not narrow.
        let identifier_type = self.get_type_of_expression(identifier);
        if !self.is_function_type(identifier_type) && !self.is_constructor_type(identifier_type) {
            return t;
        }
        // Get the prototype property of the type identifier so we can find out its type.
        let prototype_property = self.get_property_of_type(identifier_type, b"prototype");
        if prototype_property.is_nil() {
            return t;
        }
        // Get the type of the prototype, if it is undefined, or the global `Object` or `Function` types then do not narrow.
        let prototype_type = self.get_type_of_symbol(prototype_property);
        let mut candidate = TypeId::NIL;
        if !is_type_any(self, prototype_type) {
            candidate = prototype_type;
        }
        if candidate.is_nil()
            || candidate == self.global_object_type
            || candidate == self.global_function_type
        {
            return t;
        }
        // If the type that is being narrowed is `any` then just return the `candidate` type since every type is a subtype of `any`.
        if is_type_any(self, t) {
            return candidate;
        }
        // Filter out types that are not considered to be "constructed by" the `candidate` type.
        self.filter_type(t, &mut |c, t| c.is_constructed_by(t, candidate))
    }

    pub fn is_constructed_by(&mut self, source: TypeId, target: TypeId) -> bool {
        // If either the source or target type are a class type then we need to check that they are the same exact type. This is because you may have a class `A` that defines some set of properties, and another class `B` that defines the same set of properties as class `A`, in that case they are structurally the same type, but when you do something like `instanceOfA.constructor === B` it will return false.
        if self.types[source].flags.intersects(TypeFlags::OBJECT)
            && self.types[source]
                .object_flags
                .intersects(ObjectFlags::CLASS)
            || self.types[target].flags.intersects(TypeFlags::OBJECT)
                && self.types[target]
                    .object_flags
                    .intersects(ObjectFlags::CLASS)
        {
            return self.types[source].symbol == self.types[target].symbol;
        }
        // For all other types just check that the `source` type is a subtype of the `target` type.
        self.is_type_subtype_of(source, target)
    }

    pub fn narrow_type_by_boolean_comparison(
        &mut self,
        f: FlowStateId,
        t: TypeId,
        expr: NodeId,
        bool_value: NodeId,
        operator: Kind,
        assume_true: bool,
    ) -> TypeId {
        let a = self.ast;
        let assume_true = (assume_true != (a.kind(bool_value) == Kind::TrueKeyword))
            != (operator != Kind::ExclamationEqualsEqualsToken
                && operator != Kind::ExclamationEqualsToken);
        self.narrow_type(f, t, expr, assume_true)
    }

    // Upstream takes the `*ast.BinaryExpression`: here `expr` is the node of the binary expression.
    pub fn narrow_type_by_instanceof(
        &mut self,
        f: FlowStateId,
        t: TypeId,
        expr: NodeId,
        assume_true: bool,
    ) -> TypeId {
        let a = self.ast;
        let binary = a.as_binary_expression(expr);
        let reference = self.flow_states[f].reference;
        let left = self.get_reference_candidate(binary.left);
        if !self.is_matching_reference(reference, left) {
            if assume_true
                && self.strict_null_checks
                && self.optional_chain_contains_reference(left, reference)
            {
                return self.get_adjusted_type_with_facts(t, TypeFacts::NE_UNDEFINED_OR_NULL);
            }
            return t;
        }
        let right = binary.right;
        let right_type = self.get_type_of_expression(right);
        if !self.is_type_derived_from(right_type, self.global_object_type) {
            return t;
        }
        // if the right-hand side has an object type with a custom `[Symbol.hasInstance]` method, and that method has a type predicate, use the type predicate to perform narrowing. This allows normal `object` types to participate in `instanceof`, as per Step 2 of https://tc39.es/ecma262/#sec-instanceofoperator.
        let mut predicate = TypePredicateId::NIL;
        let signature = self.get_effects_signature(expr);
        if !signature.is_nil() {
            predicate = self.get_type_predicate_of_signature(signature);
        }
        if !predicate.is_nil()
            && self.type_predicates[predicate].kind == TypePredicateKind::IDENTIFIER
            && self.type_predicates[predicate].parameter_index == 0
        {
            let predicate_type = self.type_predicates[predicate].t;
            return self.get_narrowed_type(t, predicate_type, assume_true, true);
        }
        if !self.is_type_derived_from(right_type, self.global_function_type) {
            return t;
        }
        let instance_type = self.map_type(right_type, &mut |c, t| c.get_instance_type(t));
        // Don't narrow from `any` if the target type is exactly `Object` or `Function`, and narrow in the false branch only if the target is a non-empty object type.
        if is_type_any(self, t)
            && (instance_type == self.global_object_type
                || instance_type == self.global_function_type)
            || !assume_true
                && !(self.types[instance_type]
                    .flags
                    .intersects(TypeFlags::OBJECT)
                    && !self.is_empty_anonymous_object_type(instance_type))
        {
            return t;
        }
        self.get_narrowed_type(t, instance_type, assume_true, true)
    }

    pub fn get_narrowed_type(
        &mut self,
        t: TypeId,
        candidate: TypeId,
        assume_true: bool,
        check_derived: bool,
    ) -> TypeId {
        if !self.types[t].flags.intersects(TypeFlags::UNION) {
            return self.get_narrowed_type_worker(t, candidate, assume_true, check_derived);
        }
        let key = NarrowedTypeKey {
            t,
            candidate,
            assume_true,
            check_derived,
        };
        if let Some(narrowed_type) = self.narrowed_types.get_ok(&key) {
            return narrowed_type;
        }
        let narrowed_type = self.get_narrowed_type_worker(t, candidate, assume_true, check_derived);
        let ok = self.narrowed_types.set(key, narrowed_type);
        self.map_set(ok);
        narrowed_type
    }

    pub fn get_narrowed_type_worker(
        &mut self,
        t: TypeId,
        candidate: TypeId,
        assume_true: bool,
        check_derived: bool,
    ) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let mut t = t;
        if !assume_true {
            if t == candidate {
                return self.never_type;
            }
            if check_derived {
                return self.filter_type(t, &mut |c, t| !c.is_type_derived_from(t, candidate));
            }
            if self.types[t].flags.intersects(TypeFlags::UNKNOWN) {
                t = self.unknown_union_type;
            }
            let true_type = self.get_narrowed_type(t, candidate, true, false);
            let filtered_type = self.filter_type(t, &mut |c, t| !c.is_type_subset_of(t, true_type));
            return self.recombine_unknown_type(filtered_type);
        }
        if self.types[t].flags.intersects(TypeFlags::ANY_OR_UNKNOWN) {
            return candidate;
        }
        if t == candidate {
            return candidate;
        }
        // We first attempt to filter the current type, narrowing constituents as appropriate and removing constituents that are unrelated to the candidate.
        let mut key_property_name: Text<'a> = b"";
        if self.types[t].flags.intersects(TypeFlags::UNION) {
            key_property_name = self.get_key_property_name(t);
        }
        let narrowed_type = self.map_type(candidate, &mut |c, n| {
            // If a discriminant property is available, use that to reduce the type.
            let mut matching = t;
            if !key_property_name.is_empty() {
                let discriminant = c.get_type_of_property_of_type(n, key_property_name);
                if !discriminant.is_nil() {
                    let constituent = c.get_constituent_type_for_key_type(t, discriminant);
                    if !constituent.is_nil() {
                        matching = constituent;
                    }
                }
            }
            // For each constituent t in the current type, if t and c are directly related, pick the most specific of the two. When t and c are related in both directions, we prefer c for type predicates because that is the asserted type, but t for `instanceof` because generics aren't reflected in prototype object types.
            let directly_related = if check_derived {
                c.map_type(matching, &mut |c, t| {
                    if c.is_type_derived_from(t, n) {
                        return t;
                    }
                    if c.is_type_derived_from(n, t) {
                        return n;
                    }
                    c.never_type
                })
            } else {
                c.map_type(matching, &mut |c, t| {
                    if c.is_type_strict_subtype_of(t, n) {
                        return t;
                    }
                    if c.is_type_strict_subtype_of(n, t) {
                        return n;
                    }
                    if c.is_type_subtype_of(t, n) {
                        return t;
                    }
                    if c.is_type_subtype_of(n, t) {
                        return n;
                    }
                    c.never_type
                })
            };
            if !c.types[directly_related].flags.intersects(TypeFlags::NEVER) {
                return directly_related;
            }
            // If no constituents are directly related, create intersections for any generic constituents that are related by constraint.
            c.map_type(t, &mut |c, t| {
                if c.maybe_type_of_kind(t, TypeFlags::INSTANTIABLE) {
                    let constraint = c.get_base_constraint_of_type(t);
                    let is_related = constraint.is_nil()
                        || if check_derived {
                            c.is_type_derived_from(n, constraint)
                        } else {
                            c.is_type_subtype_of(n, constraint)
                        };
                    if is_related {
                        return c.get_intersection_type(List::from_slice(&[t, n]));
                    }
                }
                c.never_type
            })
        });
        // If filtering produced a non-empty type, return that. Otherwise, pick the most specific of the two based on assignability, or as a last resort produce an intersection.
        if !self.types[narrowed_type].flags.intersects(TypeFlags::NEVER) {
            return narrowed_type;
        }
        if self.is_type_subtype_of(candidate, t) {
            return candidate;
        }
        if self.is_type_assignable_to(t, candidate) {
            return t;
        }
        if self.is_type_assignable_to(candidate, t) {
            return candidate;
        }
        self.get_intersection_type(List::from_slice(&[t, candidate]))
    }

    pub fn get_instance_type(&mut self, constructor_type: TypeId) -> TypeId {
        let prototype_property_type =
            self.get_type_of_property_of_type(constructor_type, b"prototype");
        if !prototype_property_type.is_nil() && !is_type_any(self, prototype_property_type) {
            return prototype_property_type;
        }
        let construct_signatures =
            self.get_signatures_of_type(constructor_type, SignatureKind::CONSTRUCT);
        if construct_signatures.len() != 0 {
            let mut return_types: Vec<TypeId> =
                Vec::with_capacity(construct_signatures.as_slice().len());
            for &signature in construct_signatures.as_slice() {
                let erased_signature = self.get_erased_signature(signature);
                return_types.push(self.get_return_type_of_signature(erased_signature));
            }
            return self.get_union_type(List::from_slice(&return_types));
        }
        // We use the empty object type to indicate we don't know the type of objects created by this constructor function.
        self.empty_object_type
    }

    // Upstream takes the `*ast.BinaryExpression`: here `expr` is the node of the binary expression.
    pub fn narrow_type_by_private_identifier_in_in_expression(
        &mut self,
        f: FlowStateId,
        t: TypeId,
        expr: NodeId,
        assume_true: bool,
    ) -> TypeId {
        let a = self.ast;
        let binary = a.as_binary_expression(expr);
        let target = self.get_reference_candidate(binary.right);
        let reference = self.flow_states[f].reference;
        if !self.is_matching_reference(reference, target) {
            return t;
        }
        let symbol = self.get_symbol_for_private_identifier_expression(binary.left);
        if symbol.is_nil() {
            return t;
        }
        let class_symbol = a.sym(symbol).parent;
        let target_type = if has_static_modifier(a, a.sym(symbol).value_declaration) {
            self.get_type_of_symbol(class_symbol)
        } else {
            self.get_declared_type_of_symbol(class_symbol)
        };
        self.get_narrowed_type(t, target_type, assume_true, true)
    }

    pub fn narrow_type_by_in_keyword(
        &mut self,
        f: FlowStateId,
        t: TypeId,
        name_type: TypeId,
        assume_true: bool,
    ) -> TypeId {
        let _ = f;
        let name = get_property_name_from_type(self, name_type);
        let name: &[u8] = &name;
        let is_known_property = some_type(self, t, &mut |c, t| {
            c.is_type_presence_possible(t, name, true)
        });
        if is_known_property {
            // If the check is for a known property (i.e. a property declared in some constituent of the target type), we filter the target type by presence of absence of the property.
            return self.filter_type(t, &mut |c, t| {
                c.is_type_presence_possible(t, name, assume_true)
            });
        }
        if assume_true {
            // If the check is for an unknown property, we intersect the target type with `Record<X, unknown>`, where X is the name of the property.
            let record_symbol = self.get_global_record_symbol();
            if !record_symbol.is_nil() {
                let record_type = self.get_type_alias_instantiation(
                    record_symbol,
                    List::from_slice(&[name_type, self.unknown_type]),
                    TypeAliasId::NIL,
                );
                return self.get_intersection_type(List::from_slice(&[t, record_type]));
            }
        }
        t
    }

    pub fn is_type_presence_possible(
        &mut self,
        t: TypeId,
        prop_name: &[u8],
        assume_true: bool,
    ) -> bool {
        let a = self.ast;
        let prop = self.get_property_of_type(t, prop_name);
        if !prop.is_nil() {
            return a.sym(prop).flags.intersects(SymbolFlags::OPTIONAL)
                || a.sym(prop).check_flags.intersects(CheckFlags::PARTIAL)
                || assume_true;
        }
        !self
            .get_applicable_index_info_for_name(t, prop_name)
            .is_nil()
            || !assume_true
    }

    pub fn narrow_type_by_optional_chain_containment(
        &mut self,
        f: FlowStateId,
        t: TypeId,
        operator: Kind,
        value: NodeId,
        assume_true: bool,
    ) -> TypeId {
        let _ = f;
        // We are in a branch of obj?.foo === value (or any one of the other equality operators). We narrow obj as follows: When operator is === and type of value excludes undefined, null and undefined is removed from type of obj in true branch. When operator is !== and type of value excludes undefined, null and undefined is removed from type of obj in false branch. When operator is == and type of value excludes null and undefined, null and undefined is removed from type of obj in true branch. When operator is != and type of value excludes null and undefined, null and undefined is removed from type of obj in false branch. When operator is === and type of value is undefined, null and undefined is removed from type of obj in false branch. When operator is !== and type of value is undefined, null and undefined is removed from type of obj in true branch. When operator is == and type of value is null or undefined, null and undefined is removed from type of obj in false branch. When operator is != and type of value is null or undefined, null and undefined is removed from type of obj in true branch.
        let equals_operator =
            operator == Kind::EqualsEqualsToken || operator == Kind::EqualsEqualsEqualsToken;
        let nullable_flags =
            if operator == Kind::EqualsEqualsToken || operator == Kind::ExclamationEqualsToken {
                TypeFlags::NULLABLE
            } else {
                TypeFlags::UNDEFINED
            };
        let value_type = self.get_type_of_expression(value);
        // Note that we include any and unknown in the exclusion test because their domain includes null and undefined.
        let remove_nullable = equals_operator != assume_true
            && every_type(self, value_type, &mut |c, t| {
                c.types[t].flags.intersects(nullable_flags)
            })
            || equals_operator == assume_true
                && every_type(self, value_type, &mut |c, t| {
                    !c.types[t]
                        .flags
                        .intersects(TypeFlags::ANY_OR_UNKNOWN | nullable_flags)
                });
        if remove_nullable {
            return self.get_adjusted_type_with_facts(t, TypeFacts::NE_UNDEFINED_OR_NULL);
        }
        t
    }

    pub fn get_type_at_switch_clause(&mut self, f: FlowStateId, flow: FlowNodeId) -> FlowType {
        let a = self.ast;
        let flow_node = a.flow(flow);
        let data = a.as_flow_switch_clause_data(flow_node.node);
        let expr = skip_parentheses(a, a.expression(data.switch_statement));
        let flow_type = self.get_type_at_flow_node(f, flow_node.antecedent);
        let mut t = flow_type.t;
        let reference = self.flow_states[f].reference;
        if self.is_matching_reference(reference, expr) {
            t = self.narrow_type_by_switch_on_discriminant(t, data);
        } else if a.kind(expr) == Kind::TypeOfExpression
            && self.is_matching_reference(reference, a.expression(expr))
        {
            t = self.narrow_type_by_switch_on_type_of(t, data);
        } else if a.kind(expr) == Kind::TrueKeyword {
            t = self.narrow_type_by_switch_on_true(f, t, data);
        } else {
            if self.strict_null_checks {
                if self.optional_chain_contains_reference(expr, reference) {
                    t = self.narrow_type_by_switch_optional_chain_containment(
                        t,
                        data,
                        &mut |c, t| {
                            !c.types[t]
                                .flags
                                .intersects(TypeFlags::UNDEFINED | TypeFlags::NEVER)
                        },
                    );
                } else if is_type_of_expression(a, expr)
                    && self.optional_chain_contains_reference(a.expression(expr), reference)
                {
                    t = self.narrow_type_by_switch_optional_chain_containment(
                        t,
                        data,
                        &mut |c, t| {
                            !(c.types[t].flags.intersects(TypeFlags::NEVER)
                                || c.types[t].flags.intersects(TypeFlags::STRING_LITERAL)
                                    && get_string_literal_value(c, t) == b"undefined")
                        },
                    );
                }
            }
            let access = self.get_discriminant_property_access(f, expr, t);
            if !access.is_nil() {
                t = self.narrow_type_by_switch_on_discriminant_property(t, access, data);
            }
        }
        self.new_flow_type(t, flow_type.incomplete)
    }

    pub fn narrow_type_by_switch_on_discriminant(
        &mut self,
        t: TypeId,
        data: FlowSwitchClauseData,
    ) -> TypeId {
        // We only narrow if all case expressions specify values with unit types, except for the case where `type` is unknown. In this instance we map object types to the nonPrimitive type and narrow with that.
        let switch_types = self
            .get_switch_clause_types(data.switch_statement)
            .as_slice();
        if switch_types.is_empty() {
            return t;
        }
        let clause_types = sub(
            switch_types,
            data.clause_start as isize,
            data.clause_end as isize,
        );
        let has_default_clause =
            data.clause_start == data.clause_end || clause_types.contains(&self.never_type);
        if self.types[t].flags.intersects(TypeFlags::UNKNOWN) && !has_default_clause {
            let mut ground_clause_types: Option<Vec<TypeId>> = None;
            for (i, &s) in clause_types.iter().enumerate() {
                if self.types[s]
                    .flags
                    .intersects(TypeFlags::PRIMITIVE | TypeFlags::NON_PRIMITIVE)
                {
                    if let Some(ground) = ground_clause_types.as_mut() {
                        ground.push(s);
                    }
                } else if self.types[s].flags.intersects(TypeFlags::OBJECT) {
                    let non_primitive_type = self.non_primitive_type;
                    ground_clause_types
                        .get_or_insert_with(|| clause_types.get(..i).unwrap_or(&[]).to_vec())
                        .push(non_primitive_type);
                } else {
                    return t;
                }
            }
            return match ground_clause_types {
                Some(ground) => self.get_union_type(List::from_slice(&ground)),
                None => self.get_union_type(List::from_slice(clause_types)),
            };
        }
        let discriminant_type = self.get_union_type(List::from_slice(clause_types));
        let mut case_type = TypeId::NIL;
        if self.types[discriminant_type]
            .flags
            .intersects(TypeFlags::NEVER)
        {
            case_type = self.never_type;
        } else {
            if self.types[discriminant_type]
                .flags
                .intersects(TypeFlags::PRIMITIVE)
                && self.is_uniform_union_type(t)
            {
                let regular_type = self.get_regular_type_of_literal_type(discriminant_type);
                if self.union_contains_type(t, regular_type, false) {
                    case_type = regular_type;
                }
            }
            if case_type.is_nil() {
                let filtered =
                    self.filter_type(t, &mut |c, t| c.are_types_comparable(discriminant_type, t));
                case_type = self.replace_primitives_with_literals(filtered, discriminant_type);
            }
        }
        if !has_default_clause {
            return case_type;
        }
        let default_type = self.filter_type(t, &mut |c, t| {
            if !c.is_unit_like_type(t) {
                return true;
            }
            let mut u = c.undefined_type;
            if !c.types[t].flags.intersects(TypeFlags::UNDEFINED) {
                let unit_type = c.extract_unit_type(t);
                u = c.get_regular_type_of_literal_type(unit_type);
            }
            for &st in switch_types {
                if is_unit_type(c, st) && c.are_types_comparable(st, u) {
                    return false;
                }
            }
            true
        });
        if self.types[case_type].flags.intersects(TypeFlags::NEVER) {
            return default_type;
        }
        self.get_union_type(List::from_slice(&[case_type, default_type]))
    }

    pub fn narrow_type_by_switch_on_type_of(
        &mut self,
        t: TypeId,
        data: FlowSwitchClauseData,
    ) -> TypeId {
        let a = self.ast;
        let witnesses = self.get_switch_clause_type_of_witnesses(data.switch_statement);
        if witnesses.is_nil() {
            return t;
        }
        let clauses = switch_clauses(a, data.switch_statement);
        // Equal start and end denotes implicit fallthrough; undefined marks explicit default clause.
        let default_index = find_index(clauses, |clause| a.kind(clause) == Kind::DefaultClause);
        let clause_start = data.clause_start as isize;
        let clause_end = data.clause_end as isize;
        let has_default_clause = clause_start == clause_end
            || (default_index >= clause_start && default_index < clause_end);
        if has_default_clause {
            // In the default clause we filter constituents down to those that are not-equal to all handled cases.
            let not_equal_facts = self.get_not_equal_facts_from_typeof_switch(
                clause_start,
                clause_end,
                witnesses.as_slice(),
            );
            return self.filter_type(t, &mut |c, t| {
                c.get_type_facts(t, not_equal_facts) == not_equal_facts
            });
        }
        // In the non-default cause we create a union of the type narrowed by each of the listed cases.
        let clause_witnesses = sub(witnesses.as_slice(), clause_start, clause_end);
        let mut types: Vec<TypeId> = Vec::with_capacity(clause_witnesses.len());
        for &text in clause_witnesses {
            if !text.is_empty() {
                types.push(self.narrow_type_by_type_name(t, text));
            } else {
                types.push(self.never_type);
            }
        }
        self.get_union_type(List::from_slice(&types))
    }

    pub fn narrow_type_by_switch_on_true(
        &mut self,
        f: FlowStateId,
        t: TypeId,
        data: FlowSwitchClauseData,
    ) -> TypeId {
        let a = self.ast;
        let mut t = t;
        let clauses = switch_clauses(a, data.switch_statement);
        let default_index = find_index(clauses, |clause| a.kind(clause) == Kind::DefaultClause);
        let clause_start = data.clause_start as isize;
        let clause_end = data.clause_end as isize;
        let has_default_clause = clause_start == clause_end
            || (default_index >= clause_start && default_index < clause_end);
        // First, narrow away all of the cases that preceded this set of cases.
        for &clause in sub(clauses, 0, clause_start) {
            if a.kind(clause) == Kind::CaseClause {
                t = self.narrow_type(f, t, a.expression(clause), false);
            }
        }
        // If our current set has a default, then none the other cases were hit either. There's no point in narrowing by the other cases in the set, since we can get here through other paths.
        if has_default_clause {
            for &clause in sub(clauses, clause_end, clauses.len() as isize) {
                if a.kind(clause) == Kind::CaseClause {
                    t = self.narrow_type(f, t, a.expression(clause), false);
                }
            }
            return t;
        }
        // Now, narrow based on the cases in this set.
        let clauses_in_set = sub(clauses, clause_start, clause_end);
        let mut types: Vec<TypeId> = Vec::with_capacity(clauses_in_set.len());
        for &clause in clauses_in_set {
            if a.kind(clause) == Kind::CaseClause {
                types.push(self.narrow_type(f, t, a.expression(clause), true));
            } else {
                types.push(self.never_type);
            }
        }
        self.get_union_type(List::from_slice(&types))
    }

    pub fn narrow_type_by_switch_optional_chain_containment(
        &mut self,
        t: TypeId,
        data: FlowSwitchClauseData,
        clause_check: &mut dyn FnMut(&mut Checker<'a>, TypeId) -> bool,
    ) -> TypeId {
        let mut every_clause_checks = data.clause_start != data.clause_end;
        if every_clause_checks {
            let switch_types = self
                .get_switch_clause_types(data.switch_statement)
                .as_slice();
            for &clause_type in sub(
                switch_types,
                data.clause_start as isize,
                data.clause_end as isize,
            ) {
                if !clause_check(self, clause_type) {
                    every_clause_checks = false;
                    break;
                }
            }
        }
        if every_clause_checks {
            return self.get_type_with_facts(t, TypeFacts::NE_UNDEFINED_OR_NULL);
        }
        t
    }

    pub fn narrow_type_by_switch_on_discriminant_property(
        &mut self,
        t: TypeId,
        access: NodeId,
        data: FlowSwitchClauseData,
    ) -> TypeId {
        if data.clause_start < data.clause_end && self.types[t].flags.intersects(TypeFlags::UNION) {
            let (accessed_name, _) = self.get_accessed_property_name(access);
            if !accessed_name.is_empty() && *self.get_key_property_name(t) == *accessed_name {
                let switch_types = self
                    .get_switch_clause_types(data.switch_statement)
                    .as_slice();
                let clause_types = sub(
                    switch_types,
                    data.clause_start as isize,
                    data.clause_end as isize,
                );
                let mut types: Vec<TypeId> = Vec::with_capacity(clause_types.len());
                for &s in clause_types {
                    let result = self.get_constituent_type_for_key_type(t, s);
                    if !result.is_nil() {
                        types.push(result);
                    } else {
                        types.push(self.unknown_type);
                    }
                }
                let candidate = self.get_union_type(List::from_slice(&types));
                if candidate != self.unknown_type {
                    return candidate;
                }
            }
        }
        self.narrow_type_by_discriminant(t, access, &mut |c, t| {
            c.narrow_type_by_switch_on_discriminant(t, data)
        })
    }

    // Upstream does not read its parameter `flow` either.
    pub fn get_type_at_flow_branch_label(
        &mut self,
        f: FlowStateId,
        flow: FlowNodeId,
        antecedents: FlowListId,
    ) -> FlowType {
        let _ = flow;
        let a = self.ast;
        let antecedent_start = self.antecedent_types.len();
        let mut subtype_reduction = false;
        let mut seen_incomplete = false;
        let mut bypass_flow = FlowNodeId::NIL;
        let mut list = antecedents;
        while !list.is_nil() {
            let entry = a.flow_list(list);
            list = entry.next;
            let antecedent = entry.flow;
            let antecedent_node = a.flow(antecedent);
            if bypass_flow.is_nil()
                && antecedent_node.flags.intersects(FlowFlags::SWITCH_CLAUSE)
                && a.as_flow_switch_clause_data(antecedent_node.node)
                    .is_empty()
            {
                // The antecedent is the bypass branch of a potentially exhaustive switch statement.
                bypass_flow = antecedent;
                continue;
            }
            let flow_type = self.get_type_at_flow_node(f, antecedent);
            let declared_type = self.flow_states[f].declared_type;
            let initial_type = self.flow_states[f].initial_type;
            // If the type at a particular antecedent path is the declared type and the reference is known to always be assigned (i.e. when declared and initial types are the same), there is no reason to process more antecedents since the only possible outcome is subtypes that will be removed in the final union type anyway.
            if flow_type.t == declared_type && declared_type == initial_type {
                self.antecedent_types.truncate(antecedent_start);
                return flow_type_of(flow_type.t);
            }
            if !self
                .antecedent_types
                .get(antecedent_start..)
                .unwrap_or(&[])
                .contains(&flow_type.t)
            {
                self.antecedent_types.push(flow_type.t);
            }
            // If an antecedent type is not a subset of the declared type, we need to perform subtype reduction. This happens when a "foreign" type is injected into the control flow using the instanceof operator or a user defined type predicate.
            if !self.is_type_subset_of(flow_type.t, initial_type) {
                subtype_reduction = true;
            }
            if flow_type.incomplete {
                seen_incomplete = true;
            }
        }
        if !bypass_flow.is_nil() {
            let flow_type = self.get_type_at_flow_node(f, bypass_flow);
            // If the bypass flow contributes a type we haven't seen yet and the switch statement isn't exhaustive, process the bypass flow type. Since exhaustiveness checks increase the risk of circularities, we only want to perform them when they make a difference.
            if !self.types[flow_type.t].flags.intersects(TypeFlags::NEVER)
                && !self
                    .antecedent_types
                    .get(antecedent_start..)
                    .unwrap_or(&[])
                    .contains(&flow_type.t)
                && !self.is_exhaustive_switch_statement(
                    a.as_flow_switch_clause_data(a.flow(bypass_flow).node)
                        .switch_statement,
                )
            {
                let declared_type = self.flow_states[f].declared_type;
                let initial_type = self.flow_states[f].initial_type;
                if flow_type.t == declared_type && declared_type == initial_type {
                    self.antecedent_types.truncate(antecedent_start);
                    return flow_type_of(flow_type.t);
                }
                self.antecedent_types.push(flow_type.t);
                if !self.is_type_subset_of(flow_type.t, initial_type) {
                    subtype_reduction = true;
                }
                if flow_type.incomplete {
                    seen_incomplete = true;
                }
            }
        }
        // `c.antecedentTypes[antecedentStart:]` is handed over as a copy: the union is made with the checker borrowed.
        let types = self
            .antecedent_types
            .get(antecedent_start..)
            .unwrap_or(&[])
            .to_vec();
        let reduction = if subtype_reduction {
            UnionReduction::SUBTYPE
        } else {
            UnionReduction::LITERAL
        };
        let union_type = self.get_union_or_evolving_array_type(f, &types, reduction);
        let result = self.new_flow_type(union_type, seen_incomplete);
        self.antecedent_types.truncate(antecedent_start);
        result
    }

    // At flow control branch or loop junctions, if the type along every antecedent code path is an evolving array type, we construct a combined evolving array type. Otherwise we finalize all evolving array types.
    pub fn get_union_or_evolving_array_type(
        &mut self,
        f: FlowStateId,
        types: &[TypeId],
        subtype_reduction: UnionReduction,
    ) -> TypeId {
        if is_evolving_array_type_list(self, types) {
            let mut element_types: Vec<TypeId> = Vec::with_capacity(types.len());
            for &t in types {
                element_types.push(self.get_element_type_of_evolving_array_type(t));
            }
            let element_type = self.get_union_type(List::from_slice(&element_types));
            return self.get_evolving_array_type(element_type);
        }
        let mut finalized_types: Vec<TypeId> = Vec::with_capacity(types.len());
        for &t in types {
            finalized_types.push(self.finalize_evolving_array_type(t));
        }
        let union_type = self.get_union_type_ex(
            List::from_slice(&finalized_types),
            subtype_reduction,
            TypeAliasId::NIL,
            TypeId::NIL,
        );
        let result = self.recombine_unknown_type(union_type);
        let declared_type = self.flow_states[f].declared_type;
        if result != declared_type
            && (self.types[result].flags & self.types[declared_type].flags)
                .intersects(TypeFlags::UNION)
            && self.type_types(result).as_slice() == self.type_types(declared_type).as_slice()
        {
            return declared_type;
        }
        result
    }

    pub fn get_type_at_flow_loop_label(&mut self, f: FlowStateId, flow: FlowNodeId) -> FlowType {
        let a = self.ast;
        if self.flow_states[f].ref_key.is_zero() {
            let ref_key = self.get_flow_reference_key(f);
            self.flow_states[f].ref_key = ref_key;
        }
        let ref_key = self.flow_states[f].ref_key;
        if ref_key == non_dotted_name_cache_key() {
            // No cache key is generated when binding patterns are in unnarrowable situations
            return flow_type_of(self.flow_states[f].declared_type);
        }
        let key = FlowLoopKey {
            flow_node: flow,
            ref_key,
        };
        // If we have previously computed the control flow type for the reference at this flow loop junction, return the cached type.
        let cached = self.flow_loop_cache.get(&key);
        if !cached.is_nil() {
            return flow_type_of(cached);
        }
        // If this flow loop junction and reference are already being processed, return the union of the types computed for each branch so far, marked as incomplete. It is possible to see an empty array in cases where loops are nested and the back edge of the outer loop reaches an inner loop that is already being analyzed. In such cases we restart the analysis of the inner loop, which will then see a non-empty in-process array for the outer loop and eventually terminate because the first antecedent of a loop junction is always the non-looping control flow path that leads to the top.
        let in_process = self
            .flow_loop_stack
            .iter()
            .find(|loop_info| loop_info.key == key && !loop_info.types.is_empty())
            .map(|loop_info| loop_info.types.clone());
        if let Some(types) = in_process {
            let union_type =
                self.get_union_or_evolving_array_type(f, &types, UnionReduction::LITERAL);
            return self.new_flow_type(union_type, true);
        }
        // Add the flow loop junction and reference to the in-process stack and analyze each antecedent code path.
        let mut antecedent_types: Vec<TypeId> = Vec::with_capacity(4);
        let mut subtype_reduction = false;
        let mut first_antecedent_type = flow_type_of(TypeId::NIL);
        let mut list = a.flow(flow).antecedents;
        while !list.is_nil() {
            let entry = a.flow_list(list);
            let flow_type;
            if first_antecedent_type.is_nil() {
                // The first antecedent of a loop junction is always the non-looping control flow path that leads to the top.
                first_antecedent_type = self.get_type_at_flow_node(f, entry.flow);
                flow_type = first_antecedent_type;
            } else {
                // All but the first antecedent are the looping control flow paths that lead back to the loop junction. We track these on the flow loop stack. The entry holds the types seen so far and hands them back when it is popped.
                self.flow_loop_stack.push(FlowLoopInfo {
                    key,
                    types: std::mem::take(&mut antecedent_types),
                });
                let save_flow_type_cache = std::mem::take(&mut self.flow_type_cache);
                flow_type = self.get_type_at_flow_node(f, entry.flow);
                self.flow_type_cache = save_flow_type_cache;
                if let Some(loop_info) = self.flow_loop_stack.pop() {
                    antecedent_types = loop_info.types;
                }
                // If we see a value appear in the cache it is a sign that control flow analysis was restarted and completed by checkExpressionCached. We can simply pick up the resulting type and bail out.
                let cached = self.flow_loop_cache.get(&key);
                if !cached.is_nil() {
                    return flow_type_of(cached);
                }
            }
            antecedent_types = append_if_unique(antecedent_types, flow_type.t);
            // If an antecedent type is not a subset of the declared type, we need to perform subtype reduction. This happens when a "foreign" type is injected into the control flow using the instanceof operator or a user defined type predicate.
            if !self.is_type_subset_of(flow_type.t, self.flow_states[f].initial_type) {
                subtype_reduction = true;
            }
            // If the type at a particular antecedent path is the declared type there is no reason to process more antecedents since the only possible outcome is subtypes that will be removed in the final union type anyway.
            if flow_type.t == self.flow_states[f].declared_type {
                break;
            }
            list = entry.next;
        }
        // The result is incomplete if the first antecedent (the non-looping control flow path) is incomplete.
        let reduction = if subtype_reduction {
            UnionReduction::SUBTYPE
        } else {
            UnionReduction::LITERAL
        };
        let result = self.get_union_or_evolving_array_type(f, &antecedent_types, reduction);
        if first_antecedent_type.incomplete {
            return self.new_flow_type(result, true);
        }
        let ok = self.flow_loop_cache.set(key, result);
        self.map_set(ok);
        flow_type_of(result)
    }

    pub fn get_type_at_flow_array_mutation(
        &mut self,
        f: FlowStateId,
        flow: FlowNodeId,
    ) -> FlowType {
        let a = self.ast;
        let declared_type = self.flow_states[f].declared_type;
        if declared_type == self.auto_type || declared_type == self.auto_array_type {
            let flow_node = a.flow(flow);
            let node = flow_node.node;
            let expr = if is_call_expression(a, node) {
                a.expression(a.expression(node))
            } else {
                a.expression(a.as_binary_expression(node).left)
            };
            let candidate = self.get_reference_candidate(expr);
            let reference = self.flow_states[f].reference;
            if self.is_matching_reference(reference, candidate) {
                let flow_type = self.get_type_at_flow_node(f, flow_node.antecedent);
                if self.types[flow_type.t]
                    .object_flags
                    .intersects(ObjectFlags::EVOLVING_ARRAY)
                {
                    let mut evolved_type = flow_type.t;
                    if is_call_expression(a, node) {
                        for &arg in a.arguments(node).as_slice() {
                            evolved_type = self.add_evolving_array_element_type(evolved_type, arg);
                        }
                    } else {
                        // We must get the context free expression type so as to not recur in an uncached fashion on the LHS (which causes exponential blowup in compile time)
                        let binary = a.as_binary_expression(node);
                        let index_type = self.get_context_free_type_of_expression(
                            a.as_element_access_expression(binary.left)
                                .argument_expression,
                        );
                        if self.is_type_assignable_to_kind(index_type, TypeFlags::NUMBER_LIKE) {
                            evolved_type =
                                self.add_evolving_array_element_type(evolved_type, binary.right);
                        }
                    }
                    return self.new_flow_type(evolved_type, flow_type.incomplete);
                }
                return flow_type;
            }
        }
        flow_type_of(TypeId::NIL)
    }

    pub fn get_discriminant_property_access(
        &mut self,
        f: FlowStateId,
        expr: NodeId,
        computed_type: TypeId,
    ) -> NodeId {
        // As long as the computed type is a subset of the declared type, we use the full declared type to detect a discriminant property. In cases where the computed type isn't a subset, e.g because of a preceding type predicate narrowing, we use the actual computed type.
        let declared_type = self.flow_states[f].declared_type;
        if self.types[declared_type].flags.intersects(TypeFlags::UNION)
            || self.types[computed_type].flags.intersects(TypeFlags::UNION)
        {
            let access = self.get_candidate_discriminant_property_access(f, expr);
            if !access.is_nil() {
                let (name, ok) = self.get_accessed_property_name(access);
                if ok {
                    let mut t = computed_type;
                    if self.types[declared_type].flags.intersects(TypeFlags::UNION)
                        && self.is_type_subset_of(computed_type, declared_type)
                    {
                        t = declared_type;
                    }
                    if self.is_discriminant_property(t, &name) {
                        return access;
                    }
                }
            }
        }
        NodeId::NIL
    }

    pub fn get_candidate_discriminant_property_access(
        &mut self,
        f: FlowStateId,
        expr: NodeId,
    ) -> NodeId {
        let a = self.ast;
        let reference = self.flow_states[f].reference;
        if is_binding_pattern(a, reference)
            || is_function_expression_or_arrow_function(a, reference)
            || is_object_literal_method(a, reference)
        {
            // When the reference is a binding pattern or function or arrow expression, we are narrowing a pseudo-reference in getNarrowedTypeOfSymbol. An identifier for a destructuring variable declared in the same binding pattern or parameter declared in the same parameter list is a candidate.
            if is_identifier(a, expr) {
                let symbol = self.get_resolved_symbol(expr);
                let declaration = a
                    .sym(self.get_export_symbol_of_value_symbol_if_exported(symbol))
                    .value_declaration;
                if !declaration.is_nil()
                    && (is_binding_element(a, declaration)
                        || is_parameter_declaration(a, declaration))
                    && reference == a.parent(declaration)
                    && a.initializer(declaration).is_nil()
                    && !has_dot_dot_dot_token(a, declaration)
                {
                    return declaration;
                }
            }
        } else if is_access_expression(a, expr) {
            // An access expression is a candidate if the reference matches the left hand expression.
            if self.is_matching_reference(reference, a.expression(expr)) {
                return expr;
            }
        } else if is_identifier(a, expr) {
            let symbol = self.get_resolved_symbol(expr);
            if self.is_constant_variable(symbol) {
                let declaration = a.sym(symbol).value_declaration;
                let mut initializer =
                    get_candidate_variable_declaration_initializer(a, declaration);
                // Given 'const x = obj.kind', allow 'x' as an alias for 'obj.kind'
                if !initializer.is_nil()
                    && is_access_expression(a, initializer)
                    && self.is_matching_reference(reference, a.expression(initializer))
                {
                    return initializer;
                }
                // Given 'const { kind: x } = obj', allow 'x' as an alias for 'obj.kind'
                if is_binding_element(a, declaration) && a.initializer(declaration).is_nil() {
                    initializer = get_candidate_variable_declaration_initializer(
                        a,
                        a.parent(a.parent(declaration)),
                    );
                    if !initializer.is_nil()
                        && (is_identifier(a, initializer) || is_access_expression(a, initializer))
                        && self.is_matching_reference(reference, initializer)
                    {
                        return declaration;
                    }
                }
            }
        }
        NodeId::NIL
    }
}

pub fn get_candidate_variable_declaration_initializer(a: Ast<'_>, node: NodeId) -> NodeId {
    if is_variable_declaration(a, node) && a.type_node(node).is_nil() {
        let initializer = a.initializer(node);
        if !initializer.is_nil() {
            return skip_parentheses(a, initializer);
        }
    }
    NodeId::NIL
}

impl<'a> Checker<'a> {
    // An evolving array type tracks the element types that have so far been seen in an 'x.push(value)' or 'x[n] = value' operation along the control flow graph. Evolving array types are ultimately converted into manifest array types (using getFinalArrayType) and never escape the getFlowTypeOfReference function.
    pub fn get_evolving_array_type(&mut self, element_type: TypeId) -> TypeId {
        let key = CachedTypeKey {
            kind: CachedTypeKind::EVOLVING_ARRAY_TYPE,
            type_id: element_type,
        };
        let mut result = self.cached_types.get(&key);
        if result.is_nil() {
            result = self.new_object_type(ObjectFlags::EVOLVING_ARRAY, SymbolId::NIL);
            self.as_evolving_array_type_mut(result).element_type = element_type;
            let ok = self.cached_types.set(key, result);
            self.map_set(ok);
        }
        result
    }

    pub fn get_element_type_of_evolving_array_type(&self, t: TypeId) -> TypeId {
        if self.types[t]
            .object_flags
            .intersects(ObjectFlags::EVOLVING_ARRAY)
        {
            return self.as_evolving_array_type(t).element_type;
        }
        self.never_type
    }
}

pub fn is_evolving_array_type_list(c: &Checker<'_>, types: &[TypeId]) -> bool {
    let mut has_evolving_array_type = false;
    for &t in types {
        if !c.types[t].flags.intersects(TypeFlags::NEVER) {
            if !c.types[t]
                .object_flags
                .intersects(ObjectFlags::EVOLVING_ARRAY)
            {
                return false;
            }
            has_evolving_array_type = true;
        }
    }
    has_evolving_array_type
}

impl<'a> Checker<'a> {
    // Return true if the given node is 'x' in an 'x.length', x.push(value)', 'x.unshift(value)' or 'x[n] = value' operation, where 'n' is an expression of type any, undefined, or a number-like type.
    pub fn is_evolving_array_operation_target(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        let root = self.get_reference_root(node);
        let parent = a.parent(root);
        let is_length_push_or_unshift = is_property_access_expression(a, parent)
            && (a.text(a.name(parent)) == b"length"
                || is_call_expression(a, a.parent(parent))
                    && is_identifier(a, a.name(parent))
                    && is_push_or_unshift_identifier(a, a.name(parent)));
        let mut is_element_assignment = is_element_access_expression(a, parent)
            && a.expression(parent) == root
            && is_binary_expression(a, a.parent(parent))
            && a.kind(a.as_binary_expression(a.parent(parent)).operator_token) == Kind::EqualsToken
            && a.as_binary_expression(a.parent(parent)).left == parent
            && !is_assignment_target(a, a.parent(parent));
        if is_element_assignment {
            let argument_type = self
                .get_type_of_expression(a.as_element_access_expression(parent).argument_expression);
            is_element_assignment =
                self.is_type_assignable_to_kind(argument_type, TypeFlags::NUMBER_LIKE);
        }
        is_length_push_or_unshift || is_element_assignment
    }

    // When adding evolving array element types we do not perform subtype reduction. Instead, we defer subtype reduction until the evolving array type is finalized into a manifest array type.
    pub fn add_evolving_array_element_type(
        &mut self,
        evolving_array_type: TypeId,
        node: NodeId,
    ) -> TypeId {
        let context_free_type = self.get_context_free_type_of_expression(node);
        let base_type = self.get_base_type_of_literal_type(context_free_type);
        let new_element_type = self.get_regular_type_of_object_literal(base_type);
        let element_type = self
            .as_evolving_array_type(evolving_array_type)
            .element_type;
        if self.is_type_subset_of(new_element_type, element_type) {
            return evolving_array_type;
        }
        let union_type = self.get_union_type(List::from_slice(&[element_type, new_element_type]));
        self.get_evolving_array_type(union_type)
    }

    pub fn finalize_evolving_array_type(&mut self, t: TypeId) -> TypeId {
        if self.types[t]
            .object_flags
            .intersects(ObjectFlags::EVOLVING_ARRAY)
        {
            return self.get_final_array_type(t);
        }
        t
    }

    // Upstream takes the `*EvolvingArrayType`: here `t` is the evolving array type itself.
    pub fn get_final_array_type(&mut self, t: TypeId) -> TypeId {
        if self.as_evolving_array_type(t).final_array_type.is_nil() {
            let element_type = self.as_evolving_array_type(t).element_type;
            let final_array_type = self.create_final_array_type(element_type);
            self.as_evolving_array_type_mut(t).final_array_type = final_array_type;
        }
        self.as_evolving_array_type(t).final_array_type
    }

    pub fn create_final_array_type(&mut self, element_type: TypeId) -> TypeId {
        if self.types[element_type].flags.intersects(TypeFlags::NEVER) {
            return self.auto_array_type;
        }
        if self.types[element_type].flags.intersects(TypeFlags::UNION) {
            let types = self.type_types(element_type);
            let union_type = self.get_union_type_ex(
                types,
                UnionReduction::SUBTYPE,
                TypeAliasId::NIL,
                TypeId::NIL,
            );
            return self.create_array_type(union_type);
        }
        self.create_array_type(element_type)
    }

    pub fn report_flow_control_error(&mut self, node: NodeId) {
        let a = self.ast;
        let block = find_ancestor(a, node, |n| is_function_or_module_block(a, n));
        let source_file = get_source_file_of_node(a, node);
        if block.is_nil() {
            // Upstream reads the statement list of the nil block: the error is reported at the reference node.
            let _: () = self.fail("nil block in reportFlowControlError");
            let diagnostic = self.create_diagnostic_for_node(
                node,
                diagnostics::THE_CONTAINING_FUNCTION_OR_MODULE_BODY_IS_TOO_LARGE_FOR_CONTROL_FLOW_ANALYSIS,
                &[],
            );
            self.add_diagnostic(diagnostic);
            return;
        }
        let span =
            get_range_of_token_at_position(a, source_file, a.list_pos(a.statement_list(block)));
        let diagnostic = self.diagnostic_store.new_diagnostic(
            source_file,
            span,
            diagnostics::THE_CONTAINING_FUNCTION_OR_MODULE_BODY_IS_TOO_LARGE_FOR_CONTROL_FLOW_ANALYSIS,
            &[],
        );
        self.add_diagnostic(diagnostic);
    }

    pub fn is_matching_reference(&mut self, source: NodeId, target: NodeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        match a.kind(target) {
            Kind::ParenthesizedExpression | Kind::NonNullExpression => {
                return self.is_matching_reference(source, a.expression(target));
            }
            Kind::BinaryExpression => {
                let binary = a.as_binary_expression(target);
                return is_assignment_expression(a, target, false)
                    && self.is_matching_reference(source, binary.left)
                    || is_binary_expression(a, target)
                        && a.kind(binary.operator_token) == Kind::CommaToken
                        && self.is_matching_reference(source, binary.right);
            }
            _ => {}
        }
        match a.kind(source) {
            Kind::MetaProperty => {
                return is_meta_property(a, target)
                    && a.as_meta_property(source).keyword_token
                        == a.as_meta_property(target).keyword_token
                    && a.text(a.name(source)) == a.text(a.name(target));
            }
            Kind::Identifier | Kind::PrivateIdentifier => {
                if is_this_in_type_query(a, source) {
                    return a.kind(target) == Kind::ThisKeyword;
                }
                if is_identifier(a, target)
                    && self.get_resolved_symbol(source) == self.get_resolved_symbol(target)
                {
                    return true;
                }
                if is_variable_declaration(a, target) || is_binding_element(a, target) {
                    let source_symbol = self.get_resolved_symbol(source);
                    let export_symbol =
                        self.get_export_symbol_of_value_symbol_if_exported(source_symbol);
                    return export_symbol == self.get_symbol_of_declaration(target);
                }
                return false;
            }
            Kind::ThisKeyword => {
                return a.kind(target) == Kind::ThisKeyword;
            }
            Kind::SuperKeyword => {
                return a.kind(target) == Kind::SuperKeyword;
            }
            Kind::NonNullExpression | Kind::ParenthesizedExpression | Kind::SatisfiesExpression => {
                return self.is_matching_reference(a.expression(source), target);
            }
            Kind::PropertyAccessExpression | Kind::ElementAccessExpression => {
                let (source_property_name, ok) = self.get_accessed_property_name(source);
                if ok && is_access_expression(a, target) {
                    let (target_property_name, ok) = self.get_accessed_property_name(target);
                    if ok {
                        return target_property_name == source_property_name
                            && self
                                .is_matching_reference(a.expression(source), a.expression(target));
                    }
                }
                if is_element_access_expression(a, source)
                    && is_element_access_expression(a, target)
                {
                    let source_arg = a.as_element_access_expression(source).argument_expression;
                    let target_arg = a.as_element_access_expression(target).argument_expression;
                    if is_identifier(a, source_arg) && is_identifier(a, target_arg) {
                        let symbol = self.get_resolved_symbol(source_arg);
                        if symbol == self.get_resolved_symbol(target_arg)
                            && (self.is_constant_variable(symbol)
                                || self.is_parameter_or_mutable_local_variable(symbol)
                                    && !self.is_symbol_assigned(symbol))
                        {
                            return self
                                .is_matching_reference(a.expression(source), a.expression(target));
                        }
                    }
                }
            }
            Kind::QualifiedName => {
                if is_access_expression(a, target) {
                    let (target_property_name, ok) = self.get_accessed_property_name(target);
                    if ok {
                        let qualified_name = a.as_qualified_name(source);
                        return *a.text(qualified_name.right) == *target_property_name
                            && self
                                .is_matching_reference(qualified_name.left, a.expression(target));
                    }
                }
            }
            Kind::BinaryExpression => {
                let binary = a.as_binary_expression(source);
                return is_binary_expression(a, source)
                    && a.kind(binary.operator_token) == Kind::CommaToken
                    && self.is_matching_reference(binary.right, target);
            }
            _ => {}
        }
        false
    }
}

// nonDottedNameCacheKey: the key of the one byte "?".
pub fn non_dotted_name_cache_key() -> CacheHashKey {
    let mut b = KeyBuilder::default();
    b.write_byte(b'?');
    b.hash()
}

impl<'a> Checker<'a> {
    // Return the flow cache key for a "dotted name" (i.e. a sequence of identifiers separated by dots). The key consists of the id of the symbol referenced by the leftmost identifier followed by zero or more property names separated by dots. The result is nonDottedNameCacheKey if the reference isn't a dotted name.
    pub fn get_flow_reference_key(&mut self, f: FlowStateId) -> CacheHashKey {
        let mut b = KeyBuilder::default();
        let reference = self.flow_states[f].reference;
        let declared_type = self.flow_states[f].declared_type;
        let initial_type = self.flow_states[f].initial_type;
        let flow_container = self.flow_states[f].flow_container;
        if self.write_flow_cache_key(
            &mut b,
            reference,
            declared_type,
            initial_type,
            flow_container,
        ) {
            return b.hash();
        }
        // Reference isn't a dotted name
        non_dotted_name_cache_key()
    }

    pub fn write_flow_cache_key(
        &mut self,
        b: &mut KeyBuilder,
        node: NodeId,
        declared_type: TypeId,
        initial_type: TypeId,
        flow_container: NodeId,
    ) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        match a.kind(node) {
            Kind::Identifier | Kind::ThisKeyword => {
                if a.kind(node) == Kind::Identifier && !is_this_in_type_query(a, node) {
                    let symbol = self.get_resolved_symbol(node);
                    if symbol == self.unknown_symbol {
                        return false;
                    }
                    b.write_symbol(self, symbol);
                }
                b.write_byte(b':');
                b.write_type(declared_type);
                if initial_type != declared_type {
                    b.write_byte(b'=');
                    b.write_type(initial_type);
                }
                if !flow_container.is_nil() {
                    b.write_byte(b'@');
                    b.write_node(flow_container);
                }
                true
            }
            Kind::NonNullExpression | Kind::ParenthesizedExpression => self.write_flow_cache_key(
                b,
                a.expression(node),
                declared_type,
                initial_type,
                flow_container,
            ),
            Kind::QualifiedName => {
                let qualified_name = a.as_qualified_name(node);
                if !self.write_flow_cache_key(
                    b,
                    qualified_name.left,
                    declared_type,
                    initial_type,
                    flow_container,
                ) {
                    return false;
                }
                b.write_byte(b'.');
                b.write_string(a.text(qualified_name.right));
                true
            }
            Kind::PropertyAccessExpression | Kind::ElementAccessExpression => {
                let (prop_name, ok) = self.get_accessed_property_name(node);
                if ok {
                    if !self.write_flow_cache_key(
                        b,
                        a.expression(node),
                        declared_type,
                        initial_type,
                        flow_container,
                    ) {
                        return false;
                    }
                    b.write_byte(b'.');
                    b.write_string(&prop_name);
                    return true;
                }
                if is_element_access_expression(a, node)
                    && is_identifier(a, a.as_element_access_expression(node).argument_expression)
                {
                    let symbol = self.get_resolved_symbol(
                        a.as_element_access_expression(node).argument_expression,
                    );
                    if self.is_constant_variable(symbol)
                        || self.is_parameter_or_mutable_local_variable(symbol)
                            && !self.is_symbol_assigned(symbol)
                    {
                        if !self.write_flow_cache_key(
                            b,
                            a.expression(node),
                            declared_type,
                            initial_type,
                            flow_container,
                        ) {
                            return false;
                        }
                        b.write_string(b".@");
                        b.write_symbol(self, symbol);
                        return true;
                    }
                }
                false
            }
            Kind::ObjectBindingPattern
            | Kind::ArrayBindingPattern
            | Kind::FunctionDeclaration
            | Kind::FunctionExpression
            | Kind::ArrowFunction
            | Kind::MethodDeclaration => {
                b.write_node(node);
                b.write_byte(b'#');
                b.write_type(declared_type);
                true
            }
            _ => false,
        }
    }

    pub fn get_accessed_property_name(&mut self, access: NodeId) -> (Cow<'a, [u8]>, bool) {
        let a = self.ast;
        if is_property_access_expression(a, access) {
            return (Cow::Borrowed(a.text(a.name(access))), true);
        }
        if is_element_access_expression(a, access) {
            return self.try_get_element_access_expression_name(access);
        }
        if is_binding_element(a, access) {
            return self.get_destructuring_property_name(access);
        }
        if is_parameter_declaration(a, access) {
            let index = index_of(a.parameters(a.parent(access)).as_slice(), access);
            return (Cow::Owned(itoa(index)), true);
        }
        no_name()
    }

    // Upstream takes the `*ast.ElementAccessExpression`: here `node` is the node of the element access expression.
    pub fn try_get_element_access_expression_name(
        &mut self,
        node: NodeId,
    ) -> (Cow<'a, [u8]>, bool) {
        let a = self.ast;
        let argument_expression = a.as_element_access_expression(node).argument_expression;
        if is_string_or_numeric_literal_like(a, argument_expression) {
            return (Cow::Borrowed(a.text(argument_expression)), true);
        }
        if is_entity_name_expression(a, argument_expression) {
            return self.try_get_name_from_entity_name_expression(argument_expression);
        }
        no_name()
    }

    pub fn try_get_name_from_entity_name_expression(
        &mut self,
        node: NodeId,
    ) -> (Cow<'a, [u8]>, bool) {
        let a = self.ast;
        let symbol = self.resolve_entity_name(node, SymbolFlags::VALUE, true, false, NodeId::NIL);
        if symbol.is_nil()
            || !(self.is_constant_variable(symbol)
                || a.sym(symbol).flags.intersects(SymbolFlags::ENUM_MEMBER))
        {
            return no_name();
        }
        let declaration = a.sym(symbol).value_declaration;
        if declaration.is_nil() {
            return no_name();
        }
        let t = self.try_get_type_from_type_node(declaration);
        if !t.is_nil() {
            let (name, ok) = try_get_name_from_type(self, t);
            if ok {
                return (name, true);
            }
        }
        // We exclude binding elements because their initializers don't solely determine their types and resolving full types can cause circularities (see https://github.com/microsoft/TypeScript/issues/63192).
        if has_only_expression_initializer(a, declaration)
            && !is_binding_element(a, declaration)
            && self.is_block_scoped_name_declared_before_use(declaration, node)
        {
            let initializer = a.initializer(declaration);
            if !initializer.is_nil() {
                let initializer_type = self.get_type_of_expression(initializer);
                if !initializer_type.is_nil() {
                    return try_get_name_from_type(self, initializer_type);
                }
            } else if is_enum_member(a, declaration) {
                let (text, ok) = try_get_text_of_property_name(a, a.name(declaration));
                return (Cow::Borrowed(text), ok);
            }
        }
        no_name()
    }
}

pub fn try_get_name_from_type<'a>(c: &Checker<'a>, t: TypeId) -> (Cow<'a, [u8]>, bool) {
    let flags = c.types[t].flags;
    if flags.intersects(TypeFlags::UNIQUE_ES_SYMBOL) {
        return (Cow::Borrowed(c.as_unique_es_symbol_type(t).name), true);
    }
    if flags.intersects(TypeFlags::STRING_OR_NUMBER_LITERAL) {
        return (literal_value_to_string(c, t), true);
    }
    no_name()
}

impl<'a> Checker<'a> {
    pub fn get_destructuring_property_name(&mut self, node: NodeId) -> (Cow<'a, [u8]>, bool) {
        let a = self.ast;
        let parent = a.parent(node);
        if is_binding_element(a, node) && is_object_binding_pattern(a, parent) {
            return self.get_literal_property_name_text(get_binding_element_property_name(a, node));
        }
        if is_property_assignment(a, node) || is_shorthand_property_assignment(a, node) {
            return self.get_literal_property_name_text(a.name(node));
        }
        if is_array_literal_expression(a, parent) || is_array_binding_pattern(a, parent) {
            let index = index_of(a.elements(parent).as_slice(), node);
            return (Cow::Owned(itoa(index)), true);
        }
        no_name()
    }

    pub fn get_literal_property_name_text(&mut self, name: NodeId) -> (Cow<'a, [u8]>, bool) {
        let t = self.get_literal_type_from_property_name(name);
        if self.types[t]
            .flags
            .intersects(TypeFlags::STRING_LITERAL | TypeFlags::NUMBER_LITERAL)
        {
            return (literal_value_to_string(self, t), true);
        }
        no_name()
    }

    pub fn is_constant_reference(&mut self, node: NodeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        match a.kind(node) {
            Kind::ThisKeyword => {
                return true;
            }
            Kind::Identifier => {
                if !is_this_in_type_query(a, node) {
                    let symbol = self.get_resolved_symbol(node);
                    return self.is_constant_variable(symbol)
                        || self.is_parameter_or_mutable_local_variable(symbol)
                            && !self.is_symbol_assigned(symbol)
                        || !a.sym(symbol).value_declaration.is_nil()
                            && is_function_expression(a, a.sym(symbol).value_declaration);
                }
            }
            Kind::PropertyAccessExpression | Kind::ElementAccessExpression => {
                // The resolvedSymbol property is initialized by checkPropertyAccess or checkElementAccess before we get here.
                if self.is_constant_reference(a.expression(node)) {
                    let symbol = self.get_resolved_symbol_or_nil(node);
                    if !symbol.is_nil() {
                        return self.is_readonly_symbol(symbol);
                    }
                }
            }
            Kind::ObjectBindingPattern | Kind::ArrayBindingPattern => {
                let root_declaration = get_root_declaration(a, a.parent(node));
                if is_parameter_declaration(a, root_declaration)
                    || is_variable_declaration(a, root_declaration)
                        && is_catch_clause(a, a.parent(root_declaration))
                {
                    return !self.is_some_symbol_assigned(root_declaration);
                }
                return is_variable_declaration(a, root_declaration)
                    && self.is_var_const_like(root_declaration);
            }
            _ => {}
        }
        false
    }

    pub fn contains_matching_reference(&mut self, source: NodeId, target: NodeId) -> bool {
        let a = self.ast;
        let mut source = source;
        while is_access_expression(a, source) {
            source = a.expression(source);
            if self.is_matching_reference(source, target) {
                return true;
            }
        }
        false
    }

    pub fn optional_chain_contains_reference(&mut self, source: NodeId, target: NodeId) -> bool {
        let a = self.ast;
        let mut source = source;
        while is_optional_chain(a, source) {
            source = a.expression(source);
            if self.is_matching_reference(source, target) {
                return true;
            }
        }
        false
    }

    pub fn get_reference_candidate(&mut self, node: NodeId) -> NodeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        match a.kind(node) {
            Kind::ParenthesizedExpression => {
                return self.get_reference_candidate(a.expression(node));
            }
            Kind::BinaryExpression => {
                let binary = a.as_binary_expression(node);
                match a.kind(binary.operator_token) {
                    Kind::EqualsToken
                    | Kind::BarBarEqualsToken
                    | Kind::AmpersandAmpersandEqualsToken
                    | Kind::QuestionQuestionEqualsToken => {
                        return self.get_reference_candidate(binary.left);
                    }
                    Kind::CommaToken => {
                        return self.get_reference_candidate(binary.right);
                    }
                    _ => {}
                }
            }
            _ => {}
        }
        node
    }

    pub fn get_reference_root(&mut self, node: NodeId) -> NodeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        let parent = a.parent(node);
        if is_parenthesized_expression(a, parent)
            || is_binary_expression(a, parent)
                && a.kind(a.as_binary_expression(parent).operator_token) == Kind::EqualsToken
                && a.as_binary_expression(parent).left == node
            || is_binary_expression(a, parent)
                && a.kind(a.as_binary_expression(parent).operator_token) == Kind::CommaToken
                && a.as_binary_expression(parent).right == node
        {
            return self.get_reference_root(parent);
        }
        node
    }

    pub fn has_matching_argument(&mut self, expression: NodeId, reference: NodeId) -> bool {
        let a = self.ast;
        for &argument in a.arguments(expression).as_slice() {
            if self.is_or_contains_matching_reference(reference, argument)
                || self.optional_chain_contains_reference(argument, reference)
            {
                return true;
            }
        }
        is_property_access_expression(a, a.expression(expression))
            && self.is_or_contains_matching_reference(
                reference,
                a.expression(a.expression(expression)),
            )
    }

    pub fn is_or_contains_matching_reference(&mut self, source: NodeId, target: NodeId) -> bool {
        self.is_matching_reference(source, target)
            || self.contains_matching_reference(source, target)
    }

    // Return a new type in which occurrences of the string, number and bigint primitives and placeholder template literal types in typeWithPrimitives have been replaced with occurrences of compatible and more specific types from typeWithLiterals. This is essentially a limited form of intersection between the two types. We avoid a true intersection because it is more costly and, when applied to union types, generates a large number of types we don't actually care about.
    pub fn replace_primitives_with_literals(
        &mut self,
        type_with_primitives: TypeId,
        type_with_literals: TypeId,
    ) -> TypeId {
        if self.maybe_type_of_kind(
            type_with_primitives,
            TypeFlags::STRING
                | TypeFlags::TEMPLATE_LITERAL
                | TypeFlags::NUMBER
                | TypeFlags::BIG_INT,
        ) && self.maybe_type_of_kind(
            type_with_literals,
            TypeFlags::STRING_LITERAL
                | TypeFlags::TEMPLATE_LITERAL
                | TypeFlags::STRING_MAPPING
                | TypeFlags::NUMBER_LITERAL
                | TypeFlags::BIG_INT_LITERAL,
        ) {
            return self.map_type(type_with_primitives, &mut |c, t| {
                if c.types[t].flags.intersects(TypeFlags::STRING) {
                    return c.extract_types_of_kind(
                        type_with_literals,
                        TypeFlags::STRING
                            | TypeFlags::STRING_LITERAL
                            | TypeFlags::TEMPLATE_LITERAL
                            | TypeFlags::STRING_MAPPING,
                    );
                }
                if c.is_pattern_literal_type(t)
                    && !c.maybe_type_of_kind(
                        type_with_literals,
                        TypeFlags::STRING | TypeFlags::TEMPLATE_LITERAL | TypeFlags::STRING_MAPPING,
                    )
                {
                    return c.extract_types_of_kind(type_with_literals, TypeFlags::STRING_LITERAL);
                }
                if c.types[t].flags.intersects(TypeFlags::NUMBER) {
                    return c.extract_types_of_kind(
                        type_with_literals,
                        TypeFlags::NUMBER | TypeFlags::NUMBER_LITERAL,
                    );
                }
                if c.types[t].flags.intersects(TypeFlags::BIG_INT) {
                    return c.extract_types_of_kind(
                        type_with_literals,
                        TypeFlags::BIG_INT | TypeFlags::BIG_INT_LITERAL,
                    );
                }
                t
            });
        }
        type_with_primitives
    }
}

pub fn is_coercible_under_double_equals(c: &Checker<'_>, source: TypeId, target: TypeId) -> bool {
    c.types[source]
        .flags
        .intersects(TypeFlags::NUMBER | TypeFlags::STRING | TypeFlags::BOOLEAN_LITERAL)
        && c.types[target]
            .flags
            .intersects(TypeFlags::NUMBER | TypeFlags::STRING | TypeFlags::BOOLEAN)
}

impl<'a> Checker<'a> {
    pub fn is_exhaustive_switch_statement(&mut self, node: NodeId) -> bool {
        let links = self.switch_statement_links.get(node);
        if self.switch_statement_links[links].exhaustive_state == ExhaustiveState::UNKNOWN {
            // Indicate resolution is in process
            self.switch_statement_links[links].exhaustive_state = ExhaustiveState::COMPUTING;
            let is_exhaustive = self.compute_exhaustive_switch_statement(node);
            if self.switch_statement_links[links].exhaustive_state == ExhaustiveState::COMPUTING {
                self.switch_statement_links[links].exhaustive_state = if is_exhaustive {
                    ExhaustiveState::TRUE
                } else {
                    ExhaustiveState::FALSE
                };
            }
        } else if self.switch_statement_links[links].exhaustive_state == ExhaustiveState::COMPUTING
        {
            // Resolve circularity to false
            self.switch_statement_links[links].exhaustive_state = ExhaustiveState::FALSE;
        }
        self.switch_statement_links[links].exhaustive_state == ExhaustiveState::TRUE
    }

    pub fn compute_exhaustive_switch_statement(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        if is_type_of_expression(a, a.expression(node)) {
            let witnesses = self.get_switch_clause_type_of_witnesses(node);
            if witnesses.is_nil() {
                return false;
            }
            let operand_type = self.check_expression_cached(a.expression(a.expression(node)));
            let operand_constraint = self.get_base_constraint_or_type(operand_type);
            // Get the not-equal flags for all handled cases.
            let not_equal_facts =
                self.get_not_equal_facts_from_typeof_switch(0, 0, witnesses.as_slice());
            if self.types[operand_constraint]
                .flags
                .intersects(TypeFlags::ANY_OR_UNKNOWN)
            {
                // We special case the top types to be exhaustive when all cases are handled.
                return not_equal_facts.contains(TypeFacts::ALL_TYPEOF_NE);
            }
            // A missing not-equal flag indicates that the type wasn't handled by some case.
            return !some_type(self, operand_constraint, &mut |c, t| {
                c.get_type_facts(t, not_equal_facts) == not_equal_facts
            });
        }
        let expression_type = self.check_expression_cached(a.expression(node));
        let t = self.get_base_constraint_or_type(expression_type);
        if !is_literal_type(self, t) {
            return false;
        }
        let switch_types = self.get_switch_clause_types(node).as_slice();
        if switch_types.is_empty()
            || switch_types
                .iter()
                .any(|&switch_type| is_neither_unit_type_nor_never(self, switch_type))
        {
            return false;
        }
        let regular_type = self.map_type(t, &mut |c, t| c.get_regular_type_of_literal_type(t));
        self.each_type_contained_in(regular_type, switch_types)
    }

    pub fn each_type_contained_in(&self, source: TypeId, types: &[TypeId]) -> bool {
        if self.types[source].flags.intersects(TypeFlags::UNION) {
            return !self
                .type_types(source)
                .as_slice()
                .iter()
                .any(|t| !types.contains(t));
        }
        types.contains(&source)
    }

    // Get the type names from all cases in a switch on `typeof`. The default clause and/or duplicate type names are represented as empty strings. Return nil if one or more case clause expressions are not string literals.
    pub fn get_switch_clause_type_of_witnesses(&mut self, node: NodeId) -> List<'a, Text<'a>> {
        let a = self.ast;
        let links = self.switch_statement_links.get(node);
        if !self.switch_statement_links[links].witnesses_computed {
            let clauses = switch_clauses(a, node);
            let empty: Text<'a> = b"";
            let mut witnesses: Vec<Text<'a>> = vec![empty; clauses.len()];
            let mut is_nil = false;
            for (i, &clause) in clauses.iter().enumerate() {
                if a.kind(clause) == Kind::CaseClause {
                    if !is_string_literal_like(a, a.expression(clause)) {
                        is_nil = true;
                        break;
                    }
                    let text = a.text(a.expression(clause));
                    if !witnesses.contains(&text) {
                        if let Some(slot) = witnesses.get_mut(i) {
                            *slot = text;
                        }
                    }
                }
            }
            // `witnesses = nil`: the nil list says that a case clause is not a string literal, an empty list that the switch has no clauses.
            let witnesses = if is_nil {
                List::NIL
            } else {
                self.list_of(&witnesses)
            };
            self.switch_statement_links[links].witnesses = witnesses;
            self.switch_statement_links[links].witnesses_computed = true;
        }
        self.switch_statement_links[links].witnesses
    }

    // Return the combined not-equal type facts for all cases except those between the start and end indices.
    pub fn get_not_equal_facts_from_typeof_switch(
        &self,
        start: isize,
        end: isize,
        witnesses: &[Text<'_>],
    ) -> TypeFacts {
        let mut facts = TypeFacts::NONE;
        for (i, &witness) in witnesses.iter().enumerate() {
            let i = i as isize;
            if (i < start || i >= end) && !witness.is_empty() {
                facts |= typeof_ne_facts(witness).unwrap_or(TypeFacts::TYPEOF_NE_HOST_OBJECT);
            }
        }
        facts
    }

    pub fn get_switch_clause_types(&mut self, node: NodeId) -> List<'a, TypeId> {
        let a = self.ast;
        let links = self.switch_statement_links.get(node);
        if !self.switch_statement_links[links].switch_types_computed {
            let clauses = switch_clauses(a, node);
            let mut types: Vec<TypeId> = Vec::with_capacity(clauses.len());
            for &clause in clauses {
                types.push(self.get_type_of_switch_clause(clause));
            }
            let types = self.list_of(&types);
            self.switch_statement_links[links].switch_types = types;
            self.switch_statement_links[links].switch_types_computed = true;
        }
        self.switch_statement_links[links].switch_types
    }

    pub fn get_type_of_switch_clause(&mut self, clause: NodeId) -> TypeId {
        let a = self.ast;
        if a.kind(clause) == Kind::CaseClause {
            let expression_type = self.get_type_of_expression(a.expression(clause));
            return self.get_regular_type_of_literal_type(expression_type);
        }
        self.never_type
    }

    pub fn get_effects_signature(&mut self, node: NodeId) -> SignatureId {
        let a = self.ast;
        let links = self.signature_links.get(node);
        let mut signature = self.signature_links[links].effects_signature;
        if signature.is_nil() {
            // A call expression parented by an expression statement is a potential assertion. Other call expressions are potential type predicate function calls. In order to avoid triggering circularities in control flow analysis, we use getTypeOfDottedName when resolving the call target expression of an assertion.
            let mut func_type = TypeId::NIL;
            if is_binary_expression(a, node) {
                let right_type = self.check_non_null_expression(a.as_binary_expression(node).right);
                func_type = self.get_symbol_has_instance_method_of_object_type(right_type);
            } else if is_expression_statement(a, a.parent(node)) {
                func_type = self.get_type_of_dotted_name(a.expression(node), DiagnosticId::NIL);
            } else if a.kind(a.expression(node)) != Kind::SuperKeyword {
                if is_optional_chain(a, node) {
                    let expression_type = self.check_expression(a.expression(node));
                    let optional_type =
                        self.get_optional_expression_type(expression_type, a.expression(node));
                    func_type = self.check_non_null_type(optional_type, a.expression(node));
                } else {
                    func_type = self.check_non_null_expression(a.expression(node));
                }
            }
            let mut apparent_type = TypeId::NIL;
            if !func_type.is_nil() {
                apparent_type = self.get_apparent_type(func_type);
            }
            let signatures = self
                .get_signatures_of_type(
                    or_else(apparent_type, self.unknown_type),
                    SignatureKind::CALL,
                )
                .as_slice();
            let first = at(signatures, 0);
            if signatures.len() == 1 && self.signatures[first].type_parameters.len() == 0 {
                signature = first;
            } else {
                let mut some = false;
                for &candidate in signatures {
                    if self.has_type_predicate_or_never_return_type(candidate) {
                        some = true;
                        break;
                    }
                }
                if some {
                    signature = self.get_resolved_signature(node, None, CheckMode::NORMAL);
                }
            }
            if !(!signature.is_nil() && self.has_type_predicate_or_never_return_type(signature)) {
                signature = self.unknown_signature;
            }
            self.signature_links[links].effects_signature = signature;
        }
        if signature == self.unknown_signature {
            return SignatureId::NIL;
        }
        signature
    }

    // Get the type of the `[Symbol.hasInstance]` method of an object type.
    pub fn get_symbol_has_instance_method_of_object_type(&mut self, t: TypeId) -> TypeId {
        let has_instance_property_name =
            self.get_property_name_for_known_symbol_name(b"hasInstance");
        if self.all_types_assignable_to_kind(t, TypeFlags::NON_PRIMITIVE) {
            let has_instance_property = self.get_property_of_type(t, &has_instance_property_name);
            if !has_instance_property.is_nil() {
                let has_instance_property_type = self.get_type_of_symbol(has_instance_property);
                if !has_instance_property_type.is_nil()
                    && self
                        .get_signatures_of_type(has_instance_property_type, SignatureKind::CALL)
                        .len()
                        != 0
                {
                    return has_instance_property_type;
                }
            }
        }
        TypeId::NIL
    }

    pub fn get_property_name_for_known_symbol_name(&mut self, symbol_name: &[u8]) -> Vec<u8> {
        let ctor_type = self.get_global_es_symbol_constructor_symbol_or_nil();
        if !ctor_type.is_nil() {
            let ctor_symbol_type = self.get_type_of_symbol(ctor_type);
            let unique_type = self.get_type_of_property_of_type(ctor_symbol_type, symbol_name);
            if !unique_type.is_nil() && is_type_usable_as_property_name(self, unique_type) {
                let name = get_property_name_from_type(self, unique_type);
                let mut result: Vec<u8> = Vec::with_capacity(name.len());
                result.extend_from_slice(&name);
                return result;
            }
        }
        [INTERNAL_SYMBOL_NAME_PREFIX, b"@".as_slice(), symbol_name].concat()
    }

    // We require the dotted function name in an assertion expression to be comprised of identifiers that reference function, method, class or value module symbols; or variable, property or parameter symbols with declarations that have explicit type annotations. Such references are resolvable with no possibility of triggering circularities in control flow analysis.
    pub fn get_type_of_dotted_name(&mut self, node: NodeId, diagnostic: DiagnosticId) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        if !a.flags(node).intersects(NodeFlags::IN_WITH_STATEMENT) {
            match a.kind(node) {
                Kind::Identifier => {
                    let resolved_symbol = self.get_resolved_symbol(node);
                    let symbol =
                        self.get_export_symbol_of_value_symbol_if_exported(resolved_symbol);
                    return self.get_explicit_type_of_symbol(symbol, diagnostic);
                }
                Kind::ThisKeyword => {
                    return self.get_explicit_this_type(node);
                }
                Kind::SuperKeyword => {
                    return self.check_super_expression(node);
                }
                Kind::PropertyAccessExpression => {
                    let t = self.get_type_of_dotted_name(a.expression(node), diagnostic);
                    if !t.is_nil() {
                        let name = a.name(node);
                        let mut prop = SymbolId::NIL;
                        if is_private_identifier(a, name) {
                            let type_symbol = self.types[t].symbol;
                            if !type_symbol.is_nil() {
                                prop = self.get_property_of_type(
                                    t,
                                    get_symbol_name_for_private_identifier(
                                        a,
                                        type_symbol,
                                        a.text(name),
                                    ),
                                );
                            }
                        } else {
                            prop = self.get_property_of_type(t, a.text(name));
                        }
                        if !prop.is_nil() {
                            return self.get_explicit_type_of_symbol(prop, diagnostic);
                        }
                    }
                }
                Kind::ParenthesizedExpression => {
                    return self.get_type_of_dotted_name(a.expression(node), diagnostic);
                }
                _ => {}
            }
        }
        TypeId::NIL
    }

    pub fn get_explicit_type_of_symbol(
        &mut self,
        symbol: SymbolId,
        diagnostic: DiagnosticId,
    ) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        let symbol = self.resolve_symbol(symbol);
        if !self.resolving_explicit_type_of_symbol.add_if_absent(symbol) {
            return TypeId::NIL;
        }
        // `defer c.resolvingExplicitTypeOfSymbol.Delete(symbol)`: every `return x` after the defer statement is `break 'deferred x`.
        let result = 'deferred: {
            if a.sym(symbol).flags.intersects(
                SymbolFlags::FUNCTION
                    | SymbolFlags::METHOD
                    | SymbolFlags::CLASS
                    | SymbolFlags::VALUE_MODULE,
            ) {
                break 'deferred self.get_type_of_symbol(symbol);
            }
            if a.sym(symbol)
                .flags
                .intersects(SymbolFlags::VARIABLE | SymbolFlags::PROPERTY)
            {
                if a.sym(symbol).check_flags.intersects(CheckFlags::MAPPED) {
                    let links = self.mapped_symbol_links.get(symbol);
                    let origin = self.mapped_symbol_links[links].synthetic_origin;
                    if !origin.is_nil()
                        && !self
                            .get_explicit_type_of_symbol(origin, diagnostic)
                            .is_nil()
                    {
                        break 'deferred self.get_type_of_symbol(symbol);
                    }
                }
                let declaration = a.sym(symbol).value_declaration;
                if !declaration.is_nil() {
                    if self.is_declaration_with_explicit_type_annotation(declaration) {
                        break 'deferred self.get_type_of_symbol(symbol);
                    }
                    if is_variable_declaration(a, declaration)
                        && is_for_of_statement(a, a.parent(a.parent(declaration)))
                    {
                        let statement = a.parent(a.parent(declaration));
                        let expression_type = self
                            .get_type_of_dotted_name(a.expression(statement), DiagnosticId::NIL);
                        if !expression_type.is_nil() {
                            let use_ = if !a
                                .as_for_in_or_of_statement(statement)
                                .await_modifier
                                .is_nil()
                            {
                                IterationUse::FOR_AWAIT_OF
                            } else {
                                IterationUse::FOR_OF
                            };
                            break 'deferred self.check_iterated_type_or_element_type(
                                use_,
                                expression_type,
                                self.undefined_type,
                                NodeId::NIL,
                            );
                        }
                    }
                    if !diagnostic.is_nil() {
                        let name = self.symbol_to_string(symbol);
                        let related_info = self.create_diagnostic_for_node(
                            declaration,
                            diagnostics::X_0_NEEDS_AN_EXPLICIT_TYPE_ANNOTATION,
                            &[Arg::Str(&name)],
                        );
                        self.diagnostic_store
                            .add_related_info(diagnostic, related_info);
                    }
                }
            }
            TypeId::NIL
        };
        self.resolving_explicit_type_of_symbol.delete(&symbol);
        result
    }

    pub fn is_declaration_with_explicit_type_annotation(&self, node: NodeId) -> bool {
        let a = self.ast;
        (is_variable_declaration(a, node)
            || is_property_declaration(a, node)
            || is_property_signature_declaration(a, node)
            || is_parameter_declaration(a, node))
            && !a.type_node(node).is_nil()
            || self.is_expando_property_function_with_return_type_annotation(node)
    }

    pub fn is_expando_property_function_with_return_type_annotation(&self, node: NodeId) -> bool {
        let a = self.ast;
        if is_binary_expression(a, node) {
            let expr = a.as_binary_expression(node).right;
            if is_function_like(a, expr) && !a.type_node(expr).is_nil() {
                return true;
            }
        }
        false
    }

    pub fn has_type_predicate_or_never_return_type(&mut self, sig: SignatureId) -> bool {
        if !self.get_type_predicate_of_signature(sig).is_nil() {
            return true;
        }
        let declaration = self.signatures[sig].declaration;
        if declaration.is_nil() {
            return false;
        }
        let return_type = or_else(
            self.get_return_type_from_annotation(declaration),
            self.unknown_type,
        );
        self.types[return_type].flags.intersects(TypeFlags::NEVER)
    }

    pub fn get_explicit_this_type(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        let container = get_this_container(a, node, false, false);
        if is_function_like(a, container) {
            let signature = self.get_signature_from_declaration(container);
            let this_parameter = self.signatures[signature].this_parameter;
            if !this_parameter.is_nil() {
                return self.get_explicit_type_of_symbol(this_parameter, DiagnosticId::NIL);
            }
        }
        if !a.parent(container).is_nil() && is_class_like(a, a.parent(container)) {
            let symbol = self.get_symbol_of_declaration(a.parent(container));
            if is_static(a, container) {
                return self.get_type_of_symbol(symbol);
            }
            let declared_type = self.get_declared_type_of_symbol(symbol);
            return self.as_interface_type(declared_type).this_type;
        }
        TypeId::NIL
    }

    pub fn get_initial_type(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        match a.kind(node) {
            Kind::VariableDeclaration => self.get_initial_type_of_variable_declaration(node),
            Kind::BindingElement => self.get_initial_type_of_binding_element(node),
            _ => self.fail_detail("Unhandled case in getInitialType", a.kind(node) as u32),
        }
    }

    pub fn get_initial_type_of_variable_declaration(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        if !a.initializer(node).is_nil() {
            return self.get_type_of_initializer(a.initializer(node));
        }
        if is_for_in_statement(a, a.parent(a.parent(node))) {
            return self.string_type;
        }
        if is_for_of_statement(a, a.parent(a.parent(node))) {
            let t = self.check_right_hand_side_of_for_of(a.parent(a.parent(node)));
            if !t.is_nil() {
                return t;
            }
        }
        self.error_type
    }

    pub fn get_type_of_initializer(&mut self, node: NodeId) -> TypeId {
        // Return the cached type if one is available. If the type of the variable was inferred from its initializer, we'll already have cached the type. Otherwise we compute it now without caching such that transient types are reflected.
        if self.type_node_links.has(node) {
            let links = self.type_node_links.get(node);
            let t = self.type_node_links[links].resolved_type;
            if !t.is_nil() {
                return t;
            }
        }
        self.get_type_of_expression(node)
    }

    pub fn get_initial_type_of_binding_element(&mut self, node: NodeId) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        let pattern = a.parent(node);
        let parent_type = self.get_initial_type(a.parent(pattern));
        let t = if is_object_binding_pattern(a, pattern) {
            self.get_type_of_destructured_property(
                parent_type,
                get_binding_element_property_name(a, node),
            )
        } else if !has_dot_dot_dot_token(a, node) {
            self.get_type_of_destructured_array_element(
                parent_type,
                index_of(a.elements(pattern).as_slice(), node),
            )
        } else {
            self.get_type_of_destructured_spread_expression(parent_type)
        };
        self.get_type_with_default(t, a.initializer(node))
    }

    pub fn get_assigned_type(&mut self, node: NodeId) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        let parent = a.parent(node);
        match a.kind(parent) {
            Kind::ForInStatement => {
                return self.string_type;
            }
            Kind::ForOfStatement => {
                let t = self.check_right_hand_side_of_for_of(parent);
                if !t.is_nil() {
                    return t;
                }
            }
            Kind::BinaryExpression => {
                return self.get_assigned_type_of_binary_expression(parent);
            }
            Kind::DeleteExpression => {
                return self.undefined_type;
            }
            Kind::ArrayLiteralExpression => {
                return self.get_assigned_type_of_array_literal_element(parent, node);
            }
            Kind::SpreadElement => {
                return self.get_assigned_type_of_spread_expression(parent);
            }
            Kind::PropertyAssignment => {
                return self.get_assigned_type_of_property_assignment(parent);
            }
            Kind::ShorthandPropertyAssignment => {
                return self.get_assigned_type_of_shorthand_property_assignment(parent);
            }
            _ => {}
        }
        self.error_type
    }

    pub fn get_assigned_type_of_binary_expression(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        let is_destructuring_default_assignment = is_array_literal_expression(a, a.parent(node))
            && self.is_destructuring_assignment_target(a.parent(node))
            || is_property_assignment(a, a.parent(node))
                && self.is_destructuring_assignment_target(a.parent(a.parent(node)));
        if is_destructuring_default_assignment {
            let assigned_type = self.get_assigned_type(node);
            return self.get_type_with_default(assigned_type, a.as_binary_expression(node).right);
        }
        self.get_type_of_expression(a.as_binary_expression(node).right)
    }

    pub fn get_assigned_type_of_array_literal_element(
        &mut self,
        node: NodeId,
        element: NodeId,
    ) -> TypeId {
        let a = self.ast;
        let assigned_type = self.get_assigned_type(node);
        self.get_type_of_destructured_array_element(
            assigned_type,
            index_of(a.elements(node).as_slice(), element),
        )
    }

    pub fn get_type_of_destructured_array_element(&mut self, t: TypeId, index: isize) -> TypeId {
        if every_type(self, t, &mut |c, t| c.is_tuple_like_type(t)) {
            let element_type = self.get_tuple_element_type(t, index);
            if !element_type.is_nil() {
                return element_type;
            }
        }
        let element_type = self.check_iterated_type_or_element_type(
            IterationUse::DESTRUCTURING,
            t,
            self.undefined_type,
            NodeId::NIL,
        );
        if !element_type.is_nil() {
            return self.include_undefined_in_index_signature(element_type);
        }
        self.error_type
    }

    pub fn include_undefined_in_index_signature(&mut self, t: TypeId) -> TypeId {
        if t.is_nil() {
            return TypeId::NIL;
        }
        if self.compiler_options.no_unchecked_indexed_access == Tristate::TRUE {
            return self.get_union_type(List::from_slice(&[t, self.missing_type]));
        }
        t
    }

    pub fn get_assigned_type_of_spread_expression(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        let assigned_type = self.get_assigned_type(a.parent(node));
        self.get_type_of_destructured_spread_expression(assigned_type)
    }

    pub fn get_type_of_destructured_spread_expression(&mut self, t: TypeId) -> TypeId {
        let mut element_type = self.check_iterated_type_or_element_type(
            IterationUse::DESTRUCTURING,
            t,
            self.undefined_type,
            NodeId::NIL,
        );
        if element_type.is_nil() {
            element_type = self.error_type;
        }
        self.create_array_type(element_type)
    }

    pub fn get_assigned_type_of_property_assignment(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        let assigned_type = self.get_assigned_type(a.parent(node));
        self.get_type_of_destructured_property(assigned_type, a.name(node))
    }

    pub fn get_type_of_destructured_property(&mut self, t: TypeId, name: NodeId) -> TypeId {
        let name_type = self.get_literal_type_from_property_name(name);
        if !is_type_usable_as_property_name(self, name_type) {
            return self.error_type;
        }
        let text = get_property_name_from_type(self, name_type);
        let prop_type = self.get_type_of_property_of_type(t, &text);
        if !prop_type.is_nil() {
            return prop_type;
        }
        let index_info = self.get_applicable_index_info_for_name(t, &text);
        if !index_info.is_nil() {
            return self
                .include_undefined_in_index_signature(self.index_infos[index_info].value_type);
        }
        self.error_type
    }

    pub fn get_assigned_type_of_shorthand_property_assignment(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        let assigned_type = self.get_assigned_type_of_property_assignment(node);
        self.get_type_with_default(
            assigned_type,
            a.as_shorthand_property_assignment(node)
                .object_assignment_initializer,
        )
    }

    pub fn is_destructuring_assignment_target(&self, parent: NodeId) -> bool {
        let a = self.ast;
        is_binary_expression(a, a.parent(parent))
            && a.as_binary_expression(a.parent(parent)).left == parent
            || is_for_of_statement(a, a.parent(parent)) && a.initializer(a.parent(parent)) == parent
    }

    pub fn get_type_with_default(&mut self, t: TypeId, default_expression: NodeId) -> TypeId {
        if !default_expression.is_nil() {
            let non_undefined_type = self.get_non_undefined_type(t);
            let default_type = self.get_type_of_expression(default_expression);
            return self.get_union_type(List::from_slice(&[non_undefined_type, default_type]));
        }
        t
    }

    // Remove those constituent types of declaredType to which no constituent type of assignedType is assignable. For example, when a variable of type number | string | boolean is assigned a value of type number | boolean, we remove type string.
    pub fn get_assignment_reduced_type(
        &mut self,
        declared_type: TypeId,
        assigned_type: TypeId,
    ) -> TypeId {
        if declared_type == assigned_type {
            return declared_type;
        }
        if self.types[assigned_type].flags.intersects(TypeFlags::NEVER) {
            return assigned_type;
        }
        let key = AssignmentReducedKey {
            id1: declared_type,
            id2: assigned_type,
        };
        let mut result = self.assignment_reduced_types.get(&key);
        if result.is_nil() {
            result = self.get_assignment_reduced_type_worker(declared_type, assigned_type);
            let ok = self.assignment_reduced_types.set(key, result);
            self.map_set(ok);
        }
        result
    }

    pub fn get_assignment_reduced_type_worker(
        &mut self,
        declared_type: TypeId,
        assigned_type: TypeId,
    ) -> TypeId {
        let filtered_type = self.filter_type(declared_type, &mut |c, t| {
            c.type_maybe_assignable_to(assigned_type, t)
        });
        // Ensure that we narrow to fresh types if the assignment is a fresh boolean literal type.
        let mut reduced_type = filtered_type;
        if self.types[assigned_type]
            .flags
            .intersects(TypeFlags::BOOLEAN_LITERAL)
            && is_fresh_literal_type(self, assigned_type)
        {
            reduced_type = self.map_type(filtered_type, &mut |c, t| {
                c.get_fresh_type_of_literal_type(t)
            });
        }
        // Our crude heuristic produces an invalid result in some cases: see GH#26130. For now, when that happens, we give up and don't narrow at all.  (This also means we'll never narrow for erroneous assignments where the assigned type is not assignable to the declared type.)
        if self.is_type_assignable_to(assigned_type, reduced_type) {
            return reduced_type;
        }
        declared_type
    }

    pub fn type_maybe_assignable_to(&mut self, source: TypeId, target: TypeId) -> bool {
        if !self.types[source].flags.intersects(TypeFlags::UNION) {
            return self.is_type_assignable_to(source, target);
        }
        // Quick exit when source union contains the target type
        let types = self.type_types(source);
        if contains_type(self, types, target) {
            return true;
        }
        // Otherwise, check if any constituent type of the source union is assignable to the target type
        for &t in types.as_slice() {
            if self.is_type_assignable_to(t, target) {
                return true;
            }
        }
        false
    }

    pub fn get_type_predicate_argument(
        &self,
        predicate: TypePredicateId,
        call_expression: NodeId,
    ) -> NodeId {
        let a = self.ast;
        let kind = self.type_predicates[predicate].kind;
        if kind == TypePredicateKind::IDENTIFIER || kind == TypePredicateKind::ASSERTS_IDENTIFIER {
            let arguments = a.arguments(call_expression);
            let parameter_index = self.type_predicates[predicate].parameter_index as isize;
            if parameter_index >= 0 && parameter_index < arguments.len() {
                return arguments.at(parameter_index);
            }
        } else {
            let invoked_expression = skip_parentheses(a, a.expression(call_expression));
            if is_access_expression(a, invoked_expression) {
                return skip_parentheses(a, a.expression(invoked_expression));
            }
        }
        NodeId::NIL
    }

    pub fn get_flow_type_in_constructor(
        &mut self,
        symbol: SymbolId,
        constructor: NodeId,
    ) -> TypeId {
        let a = self.ast;
        let mut factory = Factory::new(a);
        let name = a.sym(symbol).name;
        let access_name = if is_private_identifier_symbol_name(name) {
            factory
                .new_private_identifier(strings::slice_from(name, strings::index(name, b"@") + 1))
        } else {
            factory.new_identifier(name)
        };
        let this_keyword = factory.new_keyword_expression(Kind::ThisKeyword);
        let reference = factory.new_property_access_expression(
            this_keyword,
            NodeId::NIL,
            access_name,
            NodeFlags::NONE,
        );
        a.set_parent(a.expression(reference), reference);
        a.set_parent(reference, constructor);
        a.set_flow_node(
            reference,
            a.as_constructor_declaration(constructor).return_flow_node,
        );
        let flow_type = self.get_flow_type_of_property(reference, symbol);
        if self.no_implicit_any
            && (flow_type == self.auto_type || flow_type == self.auto_array_type)
        {
            let symbol_name = self.symbol_to_string(symbol);
            let type_name = self.type_to_string_exported(flow_type);
            self.error(
                a.sym(symbol).value_declaration,
                diagnostics::MEMBER_0_IMPLICITLY_HAS_AN_1_TYPE,
                &[Arg::Str(&symbol_name), Arg::Str(&type_name)],
            );
        }
        // We don't infer a type if assignments are only null or undefined.
        if every_type(self, flow_type, &mut |c, t| c.is_nullable_type(t)) {
            return TypeId::NIL;
        }
        self.convert_auto_to_any(flow_type)
    }

    pub fn get_flow_type_in_static_blocks(
        &mut self,
        symbol: SymbolId,
        static_blocks: List<'_, NodeId>,
    ) -> TypeId {
        let a = self.ast;
        let mut factory = Factory::new(a);
        let name = a.sym(symbol).name;
        let access_name = if is_private_identifier_symbol_name(name) {
            factory
                .new_private_identifier(strings::slice_from(name, strings::index(name, b"@") + 1))
        } else {
            factory.new_identifier(name)
        };
        for &static_block in static_blocks.as_slice() {
            let this_keyword = factory.new_keyword_expression(Kind::ThisKeyword);
            let reference = factory.new_property_access_expression(
                this_keyword,
                NodeId::NIL,
                access_name,
                NodeFlags::NONE,
            );
            a.set_parent(a.expression(reference), reference);
            a.set_parent(reference, static_block);
            a.set_flow_node(
                reference,
                a.as_class_static_block_declaration(static_block)
                    .return_flow_node,
            );
            let flow_type = self.get_flow_type_of_property(reference, symbol);
            if self.no_implicit_any
                && (flow_type == self.auto_type || flow_type == self.auto_array_type)
            {
                let symbol_name = self.symbol_to_string(symbol);
                let type_name = self.type_to_string_exported(flow_type);
                self.error(
                    a.sym(symbol).value_declaration,
                    diagnostics::MEMBER_0_IMPLICITLY_HAS_AN_1_TYPE,
                    &[Arg::Str(&symbol_name), Arg::Str(&type_name)],
                );
            }
            // We don't infer a type if assignments are only null or undefined.
            if every_type(self, flow_type, &mut |c, t| c.is_nullable_type(t)) {
                continue;
            }
            return self.convert_auto_to_any(flow_type);
        }
        TypeId::NIL
    }

    pub fn is_reachable_flow_node(&mut self, flow: FlowNodeId) -> bool {
        let f = self.get_flow_state();
        let result = self.is_reachable_flow_node_worker(f, flow, false);
        self.put_flow_state(f);
        self.last_flow_node = flow;
        self.last_flow_node_reachable = result;
        result
    }

    // Without stack left the node counts as reachable: unreachable would report TS7027 and give the unreachable never type.
    pub fn is_reachable_flow_node_worker(
        &mut self,
        f: FlowStateId,
        flow: FlowNodeId,
        no_cache_check: bool,
    ) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            let _: () = self.stack_limit();
            return true;
        }
        let a = self.ast;
        let mut flow = flow;
        let mut no_cache_check = no_cache_check;
        loop {
            if flow == self.last_flow_node {
                return self.last_flow_node_reachable;
            }
            let flow_node = a.flow(flow);
            let flags = flow_node.flags;
            if flags.intersects(FlowFlags::SHARED) {
                if !no_cache_check && self.flow_states[f].reduce_labels.is_empty() {
                    if let Some(reachable) = self.flow_node_reachable.get_ok(&flow) {
                        return reachable;
                    }
                    let reachable = self.is_reachable_flow_node_worker(f, flow, true);
                    let ok = self.flow_node_reachable.set(flow, reachable);
                    self.map_set(ok);
                    return reachable;
                }
                no_cache_check = false;
            }
            if flags.intersects(
                FlowFlags::ASSIGNMENT | FlowFlags::CONDITION | FlowFlags::ARRAY_MUTATION,
            ) {
                flow = flow_node.antecedent;
            } else if flags.intersects(FlowFlags::CALL) {
                let signature = self.get_effects_signature(flow_node.node);
                if !signature.is_nil() {
                    let predicate = self.get_type_predicate_of_signature(signature);
                    if !predicate.is_nil()
                        && self.type_predicates[predicate].kind
                            == TypePredicateKind::ASSERTS_IDENTIFIER
                        && self.type_predicates[predicate].t.is_nil()
                    {
                        let arguments = a.arguments(flow_node.node);
                        let parameter_index =
                            self.type_predicates[predicate].parameter_index as isize;
                        if parameter_index >= 0
                            && parameter_index < arguments.len()
                            && self.is_false_expression(arguments.at(parameter_index))
                        {
                            return false;
                        }
                    }
                    let return_type = self.get_return_type_of_signature(signature);
                    if self.types[return_type].flags.intersects(TypeFlags::NEVER) {
                        return false;
                    }
                }
                flow = flow_node.antecedent;
            } else if flags.intersects(FlowFlags::BRANCH_LABEL) {
                // A branching point is reachable if any branch is reachable.
                let mut list =
                    get_branch_label_antecedents(a, flow, &self.flow_states[f].reduce_labels);
                while !list.is_nil() {
                    let entry = a.flow_list(list);
                    if self.is_reachable_flow_node_worker(f, entry.flow, false) {
                        return true;
                    }
                    list = entry.next;
                }
                return false;
            } else if flags.intersects(FlowFlags::LOOP_LABEL) {
                if flow_node.antecedents.is_nil() {
                    return false;
                }
                // A loop is reachable if the control flow path that leads to the top is reachable.
                flow = a.flow_list(flow_node.antecedents).flow;
            } else if flags.intersects(FlowFlags::SWITCH_CLAUSE) {
                // The control flow path representing an unmatched value in a switch statement with no default clause is unreachable if the switch statement is exhaustive.
                let data = a.as_flow_switch_clause_data(flow_node.node);
                if data.clause_start == data.clause_end
                    && self.is_exhaustive_switch_statement(data.switch_statement)
                {
                    return false;
                }
                flow = flow_node.antecedent;
            } else if flags.intersects(FlowFlags::REDUCE_LABEL) {
                // Cache is unreliable once we start adjusting labels
                self.last_flow_node = FlowNodeId::NIL;
                self.flow_states[f].reduce_labels.push(flow_node.node);
                let result = self.is_reachable_flow_node_worker(f, flow_node.antecedent, false);
                self.flow_states[f].reduce_labels.pop();
                return result;
            } else {
                return !flags.intersects(FlowFlags::UNREACHABLE);
            }
        }
    }

    pub fn is_false_expression(&mut self, expr: NodeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        let node = skip_parentheses(a, expr);
        if a.kind(node) == Kind::FalseKeyword {
            return true;
        }
        if is_binary_expression(a, node) {
            let binary = a.as_binary_expression(node);
            return a.kind(binary.operator_token) == Kind::AmpersandAmpersandToken
                && (self.is_false_expression(binary.left)
                    || self.is_false_expression(binary.right))
                || a.kind(binary.operator_token) == Kind::BarBarToken
                    && self.is_false_expression(binary.left)
                    && self.is_false_expression(binary.right);
        }
        false
    }

    // Return true if the given flow node is preceded by a 'super(...)' call in every possible code path leading to the node.
    pub fn is_post_super_flow_node(&mut self, flow: FlowNodeId, no_cache_check: bool) -> bool {
        let f = self.get_flow_state();
        let result = self.is_post_super_flow_node_worker(f, flow, no_cache_check);
        self.put_flow_state(f);
        result
    }

    // Without stack left the node counts as post-super: the other answer would report TS17009 or TS17011.
    pub fn is_post_super_flow_node_worker(
        &mut self,
        f: FlowStateId,
        flow: FlowNodeId,
        no_cache_check: bool,
    ) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            let _: () = self.stack_limit();
            return true;
        }
        let a = self.ast;
        let mut flow = flow;
        let mut no_cache_check = no_cache_check;
        loop {
            let flow_node = a.flow(flow);
            let flags = flow_node.flags;
            if flags.intersects(FlowFlags::SHARED) {
                if !no_cache_check {
                    if let Some(post_super) = self.flow_node_post_super.get_ok(&flow) {
                        return post_super;
                    }
                    // Upstream stores the answer and goes on: the arms below compute it a second time.
                    let post_super = self.is_post_super_flow_node_worker(f, flow, true);
                    let ok = self.flow_node_post_super.set(flow, post_super);
                    self.map_set(ok);
                }
                no_cache_check = false;
            }
            if flags.intersects(
                FlowFlags::ASSIGNMENT
                    | FlowFlags::CONDITION
                    | FlowFlags::ARRAY_MUTATION
                    | FlowFlags::SWITCH_CLAUSE,
            ) {
                flow = flow_node.antecedent;
            } else if flags.intersects(FlowFlags::CALL) {
                if a.kind(a.expression(flow_node.node)) == Kind::SuperKeyword {
                    return true;
                }
                flow = flow_node.antecedent;
            } else if flags.intersects(FlowFlags::BRANCH_LABEL) {
                let mut list =
                    get_branch_label_antecedents(a, flow, &self.flow_states[f].reduce_labels);
                while !list.is_nil() {
                    let entry = a.flow_list(list);
                    if !self.is_post_super_flow_node_worker(f, entry.flow, false) {
                        return false;
                    }
                    list = entry.next;
                }
                return true;
            } else if flags.intersects(FlowFlags::LOOP_LABEL) {
                if flow_node.antecedents.is_nil() {
                    // Upstream reads the first antecedent of the loop label without a nil test: the node counts as post-super, as an unreachable node does.
                    let _: () =
                        self.fail("nil Antecedents of a loop label in isPostSuperFlowNodeWorker");
                    return true;
                }
                // A loop is post-super if the control flow path that leads to the top is post-super.
                flow = a.flow_list(flow_node.antecedents).flow;
            } else if flags.intersects(FlowFlags::REDUCE_LABEL) {
                self.flow_states[f].reduce_labels.push(flow_node.node);
                let result = self.is_post_super_flow_node_worker(f, flow_node.antecedent, false);
                self.flow_states[f].reduce_labels.pop();
                return result;
            } else {
                // Unreachable nodes are considered post-super to silence errors
                return flags.intersects(FlowFlags::UNREACHABLE);
            }
        }
    }

    // Check if a parameter, catch variable, or mutable local variable is definitely assigned anywhere
    pub fn is_symbol_assigned_definitely(&mut self, symbol: SymbolId) -> bool {
        self.ensure_assignments_marked(symbol);
        let links = self.marked_assignment_symbol_links.get(symbol);
        self.marked_assignment_symbol_links[links].has_definite_assignment
    }

    // Check if a parameter, catch variable, or mutable local variable is assigned anywhere
    pub fn is_symbol_assigned(&mut self, symbol: SymbolId) -> bool {
        self.ensure_assignments_marked(symbol);
        let links = self.marked_assignment_symbol_links.get(symbol);
        self.marked_assignment_symbol_links[links].last_assignment_pos != 0
    }

    // Return true if there are no assignments to the given symbol or if the given location is past the last assignment to the symbol.
    pub fn is_past_last_assignment(&mut self, symbol: SymbolId, location: NodeId) -> bool {
        let a = self.ast;
        self.ensure_assignments_marked(symbol);
        let links = self.marked_assignment_symbol_links.get(symbol);
        let last_assignment_pos = self.marked_assignment_symbol_links[links].last_assignment_pos;
        last_assignment_pos == 0 || !location.is_nil() && last_assignment_pos < a.pos(location)
    }

    pub fn ensure_assignments_marked(&mut self, symbol: SymbolId) {
        let a = self.ast;
        let links = self.marked_assignment_symbol_links.get(symbol);
        if self.marked_assignment_symbol_links[links].last_assignment_pos != 0 {
            return;
        }
        let parent = find_ancestor(a, a.sym(symbol).value_declaration, |node| {
            is_function_or_source_file(a, node)
        });
        if parent.is_nil() {
            return;
        }
        let links = self.node_links.get(parent);
        if !self.node_links[links]
            .flags
            .intersects(NodeCheckFlags::ASSIGNMENTS_MARKED)
        {
            self.node_links[links].flags |= NodeCheckFlags::ASSIGNMENTS_MARKED;
            if !self.has_parent_with_assignments_marked(parent) {
                self.mark_node_assignments(parent);
            }
        }
    }

    pub fn has_parent_with_assignments_marked(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        !find_ancestor(a, a.parent(node), |node| {
            if !is_function_or_source_file(a, node) {
                return false;
            }
            let links = self.node_links.get(node);
            self.node_links[links]
                .flags
                .intersects(NodeCheckFlags::ASSIGNMENTS_MARKED)
        })
        .is_nil()
    }

    // The field `markNodeAssignments` of upstream's Checker holds the method value `markNodeAssignmentsWorker` (checker.go:1261).
    pub fn mark_node_assignments(&mut self, node: NodeId) -> bool {
        self.mark_node_assignments_worker(node)
    }

    // For all assignments within the given root node, record the last assignment source position for all referenced parameters and mutable local variables. When assignments occur in nested functions  or references occur in export specifiers, record math.MaxInt32 as the assignment position. When assignments occur in compound statements, record the ending source position of the compound statement as the assignment position (this is more conservative than full control flow analysis, but requires only a single walk over the AST).
    pub fn mark_node_assignments_worker(&mut self, node: NodeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        match a.kind(node) {
            Kind::Identifier => {
                let assignment_kind = get_assignment_target_kind(a, node);
                if assignment_kind != AssignmentKind::NONE {
                    let symbol = self.get_resolved_symbol(node);
                    if self.is_parameter_or_mutable_local_variable(symbol) {
                        let links = self.marked_assignment_symbol_links.get(symbol);
                        let pos = self.marked_assignment_symbol_links[links].last_assignment_pos;
                        if pos == 0 || pos != i32::MAX {
                            let referencing_function =
                                find_ancestor(a, node, |n| is_function_or_source_file(a, n));
                            let declaring_function =
                                find_ancestor(a, a.sym(symbol).value_declaration, |n| {
                                    is_function_or_source_file(a, n)
                                });
                            if referencing_function == declaring_function {
                                let extended_pos = self.extend_assignment_position(
                                    node,
                                    a.sym(symbol).value_declaration,
                                );
                                self.marked_assignment_symbol_links[links].last_assignment_pos =
                                    extended_pos;
                            } else {
                                self.marked_assignment_symbol_links[links].last_assignment_pos =
                                    i32::MAX;
                            }
                        }
                        if assignment_kind == AssignmentKind::DEFINITE {
                            self.marked_assignment_symbol_links[links].has_definite_assignment =
                                true;
                        }
                    }
                }
                return false;
            }
            Kind::ExportSpecifier => {
                let export_declaration = a.as_export_declaration(a.parent(a.parent(node)));
                let name = a.property_name_or_name(node);
                if !a.is_type_only(node)
                    && !export_declaration.is_type_only
                    && export_declaration.module_specifier.is_nil()
                    && !is_string_literal(a, name)
                {
                    let symbol =
                        self.resolve_entity_name(name, SymbolFlags::VALUE, true, true, NodeId::NIL);
                    if !symbol.is_nil() && self.is_parameter_or_mutable_local_variable(symbol) {
                        let links = self.marked_assignment_symbol_links.get(symbol);
                        self.marked_assignment_symbol_links[links].last_assignment_pos = i32::MAX;
                    }
                }
                return false;
            }
            Kind::InterfaceDeclaration
            | Kind::TypeAliasDeclaration
            | Kind::JSTypeAliasDeclaration
            | Kind::EnumDeclaration => {
                return false;
            }
            _ => {}
        }
        if is_type_node(a, node) {
            return false;
        }
        a.for_each_child(node, &mut |child| self.mark_node_assignments(child))
    }

    // Extend the position of the given assignment target node to the end of any intervening variable statement, expression statement, compound statement, or class declaration occurring between the node and the given declaration node.
    pub fn extend_assignment_position(&self, node: NodeId, declaration: NodeId) -> i32 {
        let a = self.ast;
        let mut node = node;
        let mut pos = a.pos(node);
        while !node.is_nil() && a.pos(node) > a.pos(declaration) {
            match a.kind(node) {
                Kind::VariableStatement
                | Kind::ExpressionStatement
                | Kind::IfStatement
                | Kind::DoStatement
                | Kind::WhileStatement
                | Kind::ForStatement
                | Kind::ForInStatement
                | Kind::ForOfStatement
                | Kind::WithStatement
                | Kind::SwitchStatement
                | Kind::TryStatement
                | Kind::ClassDeclaration => {
                    pos = a.end(node);
                }
                _ => {}
            }
            node = a.parent(node);
        }
        pos
    }
}

// The narrowing helpers of checker.go:31594-31692.
impl<'a> Checker<'a> {
    // Check if a parameter or catch variable (or their bindings elements) is assigned anywhere
    pub fn is_some_symbol_assigned(&mut self, root_declaration: NodeId) -> bool {
        let a = self.ast;
        self.is_some_symbol_assigned_worker(a.name(root_declaration))
    }

    pub fn is_some_symbol_assigned_worker(&mut self, node: NodeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        if a.kind(node) == Kind::Identifier {
            let symbol = self.get_symbol_of_declaration(a.parent(node));
            return self.is_symbol_assigned(symbol);
        }
        for &e in a.elements(node).as_slice() {
            if !a.name(e).is_nil() && self.is_some_symbol_assigned_worker(a.name(e)) {
                return true;
            }
        }
        false
    }

    pub fn get_narrowable_type_for_reference(
        &mut self,
        t: TypeId,
        reference: NodeId,
        check_mode: CheckMode,
    ) -> TypeId {
        let mut t = t;
        if self.is_no_infer_type(t) {
            t = self.as_substitution_type(t).base_type;
        }
        // When the type of a reference is or contains an instantiable type with a union type constraint, and when the reference is in a constraint position (where it is known we'll obtain the apparent type) or has a contextual type containing no top-level instantiables (meaning constraints will determine assignability), we substitute constraints for all instantiables in the type of the reference to give control flow analysis an opportunity to narrow it further. For example, for a reference of a type parameter type 'T extends string | undefined' with a contextual type 'string', we substitute 'string | undefined' to give control flow analysis the opportunity to narrow to type 'string'.
        let substitute_constraints = !check_mode.intersects(CheckMode::INFERENTIAL)
            && some_type(self, t, &mut |c, t| {
                c.is_generic_type_with_union_constraint(t)
            })
            && (self.is_constraint_position(t, reference)
                || self.has_contextual_type_with_no_generic_types(reference, check_mode));
        if substitute_constraints {
            return self.map_type(t, &mut |c, t| c.get_base_constraint_or_type(t));
        }
        t
    }

    pub fn is_constraint_position(&mut self, t: TypeId, node: NodeId) -> bool {
        let a = self.ast;
        let parent = a.parent(node);
        // In an element access obj[x], we consider obj to be in a constraint position, except when obj is of a generic type without a nullable constraint and x is a generic type. This is because when both obj and x are of generic types T and K, we want the resulting type to be T[K].
        if is_property_access_expression(a, parent)
            || is_qualified_name(a, parent)
            || (is_call_expression(a, parent) || is_new_expression(a, parent))
                && a.expression(parent) == node
        {
            return true;
        }
        if !(is_element_access_expression(a, parent) && a.expression(parent) == node) {
            return false;
        }
        if !some_type(self, t, &mut |c, t| {
            c.is_generic_type_without_nullable_constraint(t)
        }) {
            return true;
        }
        let argument_type =
            self.get_type_of_expression(a.as_element_access_expression(parent).argument_expression);
        !self.is_generic_index_type(argument_type)
    }

    pub fn is_generic_type_with_union_constraint(&mut self, t: TypeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if self.types[t].flags.intersects(TypeFlags::INTERSECTION) {
            for &u in self.type_types(t).as_slice() {
                if self.is_generic_type_with_union_constraint(u) {
                    return true;
                }
            }
            return false;
        }
        if !self.types[t].flags.intersects(TypeFlags::INSTANTIABLE) {
            return false;
        }
        let constraint = self.get_base_constraint_or_type(t);
        self.types[constraint]
            .flags
            .intersects(TypeFlags::NULLABLE | TypeFlags::UNION)
    }

    pub fn is_generic_type_without_nullable_constraint(&mut self, t: TypeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if self.types[t].flags.intersects(TypeFlags::INTERSECTION) {
            for &u in self.type_types(t).as_slice() {
                if self.is_generic_type_without_nullable_constraint(u) {
                    return true;
                }
            }
            return false;
        }
        if !self.types[t].flags.intersects(TypeFlags::INSTANTIABLE) {
            return false;
        }
        let constraint = self.get_base_constraint_or_type(t);
        !self.maybe_type_of_kind(constraint, TypeFlags::NULLABLE)
    }

    pub fn has_contextual_type_with_no_generic_types(
        &mut self,
        node: NodeId,
        check_mode: CheckMode,
    ) -> bool {
        let a = self.ast;
        // Computing the contextual type for a child of a JSX element involves resolving the type of the element's tag name, so we exclude that here to avoid circularities. If check mode has `CheckMode.RestBindingElement`, we skip binding pattern contextual types, as we want the type of a rest element to be generic when possible.
        if (is_identifier(a, node)
            || is_property_access_expression(a, node)
            || is_element_access_expression(a, node))
            && !((is_jsx_opening_element(a, a.parent(node))
                || is_jsx_self_closing_element(a, a.parent(node)))
                && a.tag_name(a.parent(node)) == node)
        {
            let context_flags = if check_mode.intersects(CheckMode::REST_BINDING_ELEMENT) {
                ContextFlags::SKIP_BINDING_PATTERNS
            } else {
                ContextFlags::NONE
            };
            let contextual_type = self.get_contextual_type(node, context_flags);
            if !contextual_type.is_nil() {
                return !self.is_generic_type(contextual_type);
            }
        }
        false
    }

    pub fn get_non_undefined_type(&mut self, t: TypeId) -> TypeId {
        let mut type_or_constraint = t;
        if some_type(self, t, &mut |c, t| {
            c.is_generic_type_with_undefined_constraint(t)
        }) {
            type_or_constraint = self.map_type(t, &mut |c, t| {
                if c.types[t].flags.intersects(TypeFlags::INSTANTIABLE) {
                    return c.get_base_constraint_or_type(t);
                }
                t
            });
        }
        self.get_type_with_facts(type_or_constraint, TypeFacts::NE_UNDEFINED)
    }

    pub fn is_generic_type_with_undefined_constraint(&mut self, t: TypeId) -> bool {
        if self.types[t].flags.intersects(TypeFlags::INSTANTIABLE) {
            let constraint = self.get_base_constraint_of_type(t);
            if !constraint.is_nil() {
                return self.maybe_type_of_kind(constraint, TypeFlags::UNDEFINED);
            }
        }
        false
    }
}
