// Scratch tests: the two reachability walks of flow.rs over flow graphs of the open store.
use crate::ast::stable::Arena;
use crate::ast::{
    Ast, Factory, FlowFlags, FlowListId, FlowNodeId, Frozen, IdAllocator, Kind, NodeFactory,
    NodeFlags, NodeId, NodeListId, NodeSink, Open, new_flow_reduce_label_data,
};
use crate::checker::*;
use crate::core::CompilerOptions;

fn list(a: Ast<'_>, flows: &[FlowNodeId]) -> FlowListId {
    let mut next = FlowListId::NIL;
    for &flow in flows.iter().rev() {
        next = a.new_flow_list(flow, next);
    }
    next
}

fn label(a: Ast<'_>, flags: FlowFlags, flows: &[FlowNodeId]) -> FlowNodeId {
    let label = a.new_flow_node(flags, NodeId::NIL, FlowNodeId::NIL);
    let antecedents = list(a, flows);
    a.update_flow(label, |flow| flow.antecedents = antecedents);
    label
}

#[test]
fn reachability_follows_antecedents_labels_loops_and_reduce_labels() {
    let ids = IdAllocator::new();
    let arena = Arena::new();
    let open = Open::new(&arena, &ids);
    let frozen = Frozen::none();
    let a = Ast::new(&frozen, &open);
    let options = CompilerOptions::default();
    let mut c = Checker::for_test(a, &options);

    let start = a.new_flow_node(FlowFlags::START, NodeId::NIL, FlowNodeId::NIL);
    let unreachable = a.new_flow_node(FlowFlags::UNREACHABLE, NodeId::NIL, FlowNodeId::NIL);
    let assignment = a.new_flow_node(FlowFlags::ASSIGNMENT, NodeId::NIL, start);
    let condition = a.new_flow_node(FlowFlags::TRUE_CONDITION, NodeId::NIL, assignment);
    assert!(c.is_reachable_flow_node(condition));
    assert!(!c.is_reachable_flow_node(unreachable));
    assert_eq!(c.last_flow_node, unreachable);
    assert!(!c.last_flow_node_reachable);

    let some = label(a, FlowFlags::BRANCH_LABEL, &[unreachable, condition]);
    let none = label(a, FlowFlags::BRANCH_LABEL, &[unreachable, unreachable]);
    assert!(c.is_reachable_flow_node(some));
    assert!(!c.is_reachable_flow_node(none));

    // A loop is reachable when its first antecedent is.
    let dead_loop = label(a, FlowFlags::LOOP_LABEL, &[none, condition]);
    let live_loop = label(a, FlowFlags::LOOP_LABEL, &[condition, none]);
    let empty_loop = label(a, FlowFlags::LOOP_LABEL, &[]);
    assert!(!c.is_reachable_flow_node(dead_loop));
    assert!(c.is_reachable_flow_node(live_loop));
    assert!(!c.is_reachable_flow_node(empty_loop));

    // A shared node is answered from the cache the second time.
    let fresh_none = label(a, FlowFlags::BRANCH_LABEL, &[unreachable, unreachable]);
    let shared = a.new_flow_node(FlowFlags::ASSIGNMENT | FlowFlags::SHARED, NodeId::NIL, fresh_none);
    let after_shared = a.new_flow_node(FlowFlags::ASSIGNMENT, NodeId::NIL, shared);
    assert_eq!(c.flow_node_reachable.get_ok(&shared), None);
    assert!(!c.is_reachable_flow_node(after_shared));
    assert_eq!(c.flow_node_reachable.get_ok(&shared), Some(false));
    // The cache wins over the graph: the label gets a reachable antecedent, the shared node keeps its answer.
    let live = list(a, &[condition]);
    a.update_flow(fresh_none, |flow| flow.antecedents = live);
    c.last_flow_node = FlowNodeId::NIL;
    assert!(!c.is_reachable_flow_node(after_shared));

    // A reduce label swaps the antecedents of its target for the walk below it, and the one-entry cache is dropped.
    let target = label(a, FlowFlags::BRANCH_LABEL, &[unreachable, unreachable]);
    let below = a.new_flow_node(FlowFlags::ASSIGNMENT, NodeId::NIL, target);
    assert!(!c.is_reachable_flow_node(below));
    let data = new_flow_reduce_label_data(a, target, list(a, &[condition]));
    let reduce = a.new_flow_node(FlowFlags::REDUCE_LABEL, data, below);
    c.last_flow_node = FlowNodeId::NIL;
    assert!(c.is_reachable_flow_node(reduce));
    // Outside the reduce label the target has its own antecedents again.
    c.last_flow_node = FlowNodeId::NIL;
    assert!(!c.is_reachable_flow_node(below));
    assert_eq!(get_branch_label_antecedents(a, target, &[]), a.flow(target).antecedents);
    assert_eq!(
        a.flow_list(get_branch_label_antecedents(a, target, &[data])).flow,
        condition
    );

    // The one-entry cache answers for the node of the last question.
    assert!(c.is_reachable_flow_node(condition));
    let through = a.new_flow_node(FlowFlags::ASSIGNMENT, NodeId::NIL, condition);
    c.last_flow_node_reachable = false;
    assert!(!c.is_reachable_flow_node(through));
    assert_eq!(c.faults.get(), 0);
    // Every flow state went back to the pool.
    assert!(!c.free_flow_state.is_nil());
    assert!(c.flow_states[c.free_flow_state].next.is_nil());
}

#[test]
fn post_super_needs_a_super_call_on_every_path() {
    let ids = IdAllocator::new();
    let arena = Arena::new();
    let open = Open::new(&arena, &ids);
    let frozen = Frozen::none();
    let a = Ast::new(&frozen, &open);
    let options = CompilerOptions::default();
    let mut c = Checker::for_test(a, &options);
    let mut factory = Factory::new(a);

    let super_keyword = factory.new_keyword_expression(Kind::SuperKeyword);
    let arguments = factory.new_node_list(&[]);
    let super_call = factory.new_call_expression(
        super_keyword,
        NodeId::NIL,
        NodeListId::NIL,
        arguments,
        NodeFlags::NONE,
    );
    let callee = factory.new_identifier(b"f");
    let other_call =
        factory.new_call_expression(callee, NodeId::NIL, NodeListId::NIL, arguments, NodeFlags::NONE);

    let start = a.new_flow_node(FlowFlags::START, NodeId::NIL, FlowNodeId::NIL);
    let unreachable = a.new_flow_node(FlowFlags::UNREACHABLE, NodeId::NIL, FlowNodeId::NIL);
    let called = a.new_flow_node(FlowFlags::CALL, super_call, start);
    let after = a.new_flow_node(FlowFlags::ASSIGNMENT, NodeId::NIL, called);
    let other = a.new_flow_node(FlowFlags::CALL, other_call, start);
    assert!(c.is_post_super_flow_node(after, false));
    assert!(!c.is_post_super_flow_node(other, false));
    assert!(!c.is_post_super_flow_node(start, false));
    // Unreachable nodes are considered post-super.
    assert!(c.is_post_super_flow_node(unreachable, false));

    let both = label(a, FlowFlags::BRANCH_LABEL, &[after, unreachable]);
    let one = label(a, FlowFlags::BRANCH_LABEL, &[after, other]);
    assert!(c.is_post_super_flow_node(both, false));
    assert!(!c.is_post_super_flow_node(one, false));

    let live_loop = label(a, FlowFlags::LOOP_LABEL, &[after, other]);
    assert!(c.is_post_super_flow_node(live_loop, false));
    assert_eq!(c.faults.get(), 0);
    // A loop label without antecedents is a fault upstream: the answer is the one for unreachable nodes.
    let empty_loop = label(a, FlowFlags::LOOP_LABEL, &[]);
    assert!(c.is_post_super_flow_node(empty_loop, false));
    assert_eq!(c.faults.get(), 1);

    let shared = a.new_flow_node(FlowFlags::SWITCH_CLAUSE | FlowFlags::SHARED, NodeId::NIL, after);
    assert!(c.is_post_super_flow_node(shared, false));
    assert_eq!(c.flow_node_post_super.get_ok(&shared), Some(true));

    let target = label(a, FlowFlags::BRANCH_LABEL, &[after, other]);
    let below = a.new_flow_node(FlowFlags::CONDITION, NodeId::NIL, target);
    let data = new_flow_reduce_label_data(a, target, list(a, &[after]));
    let reduce = a.new_flow_node(FlowFlags::REDUCE_LABEL, data, below);
    assert!(!c.is_post_super_flow_node(below, false));
    assert!(c.is_post_super_flow_node(reduce, false));
}

#[test]
fn helpers_answer_what_go_answers() {
    assert_eq!(typeof_ne_facts(b"string"), Some(TypeFacts::TYPEOF_NE_STRING));
    assert_eq!(typeof_ne_facts(b"undefined"), Some(TypeFacts::NE_UNDEFINED));
    assert_eq!(typeof_ne_facts(b"host"), None);
    let mut names: Vec<&[u8]> = TYPEOF_NE_FACTS.iter().map(|entry| entry.0).collect();
    let sorted = names.clone();
    names.sort();
    assert_eq!(names, sorted);
    assert_eq!(non_dotted_name_cache_key(), CacheHashKey::of(b"?"));
    assert!(!non_dotted_name_cache_key().is_zero());
}

// The intrinsic types that the walks compare by identity.
fn intrinsics(c: &mut Checker<'_>) {
    c.error_type = c.new_test_type(TypeFlags::ANY);
    c.never_type = c.new_test_type(TypeFlags::NEVER);
    c.silent_never_type = c.new_test_type(TypeFlags::NEVER);
    c.unreachable_never_type = c.new_test_type(TypeFlags::NEVER);
    c.auto_type = c.new_test_type(TypeFlags::ANY);
    c.auto_array_type = c.new_test_type(TypeFlags::OBJECT);
    c.unknown_type = c.new_test_type(TypeFlags::UNKNOWN);
}

#[test]
fn flow_types_at_conditions_branch_labels_and_shared_nodes() {
    let ids = IdAllocator::new();
    let arena = Arena::new();
    let open = Open::new(&arena, &ids);
    let frozen = Frozen::none();
    let a = Ast::new(&frozen, &open);
    let options = CompilerOptions::default();
    let mut c = Checker::for_test(a, &options);
    intrinsics(&mut c);
    let mut factory = Factory::new(a);
    let reference = factory.new_keyword_expression(Kind::ThisKeyword);
    let condition = factory.new_keyword_expression(Kind::ThisKeyword);

    let declared = c.new_test_type(TypeFlags::OBJECT);
    let truthy = c.new_test_type(TypeFlags::OBJECT);
    let falsy = c.new_test_type(TypeFlags::OBJECT);
    c.model.facts.push((declared, TypeFacts::TRUTHY, truthy));
    c.model.facts.push((declared, TypeFacts::FALSY, falsy));

    let start = a.new_flow_node(FlowFlags::START | FlowFlags::SHARED, NodeId::NIL, FlowNodeId::NIL);
    let when_true = a.new_flow_node(FlowFlags::TRUE_CONDITION, condition, start);
    let when_false = a.new_flow_node(FlowFlags::FALSE_CONDITION, condition, start);
    // Without a flow node the declared type stands.
    assert_eq!(c.get_flow_type_of_reference(reference, declared), declared);
    assert_eq!(c.flow_invocation_count, 0);
    let at = |c: &mut Checker<'_>, flow: FlowNodeId| {
        c.get_flow_type_of_reference_ex(reference, declared, declared, NodeId::NIL, flow)
    };
    assert_eq!(at(&mut c, start), declared);
    assert_eq!(at(&mut c, when_true), truthy);
    assert_eq!(at(&mut c, when_false), falsy);
    assert_eq!(c.flow_invocation_count, 3);

    // Both branches narrowed: the union of the two, with subtype reduction because neither is a subset of the initial type.
    let join = label(a, FlowFlags::BRANCH_LABEL, &[when_true, when_false]);
    let joined = at(&mut c, join);
    assert_eq!(c.type_types(joined).as_slice(), &[truthy, falsy]);
    assert_eq!(c.model.last_reduction, UnionReduction::SUBTYPE);
    // One branch with the declared type ends the walk at once.
    let early = label(a, FlowFlags::BRANCH_LABEL, &[start, when_true]);
    assert_eq!(at(&mut c, early), declared);
    let late = label(a, FlowFlags::BRANCH_LABEL, &[when_true, start]);
    assert_eq!(at(&mut c, late), declared);
    // A label with one antecedent is skipped.
    let single = label(a, FlowFlags::BRANCH_LABEL, &[when_false]);
    assert_eq!(at(&mut c, single), falsy);
    // An unreachable node gives the declared type.
    let unreachable = a.new_flow_node(FlowFlags::UNREACHABLE, NodeId::NIL, FlowNodeId::NIL);
    assert_eq!(at(&mut c, unreachable), declared);
    // A reduce label swaps the antecedents of the label below it.
    let data = new_flow_reduce_label_data(a, join, list(a, &[when_true]));
    let reduce = a.new_flow_node(FlowFlags::REDUCE_LABEL, data, join);
    assert_eq!(at(&mut c, reduce), truthy);
    assert_eq!(at(&mut c, join), joined);

    // Every stack is back where it was, and one flow state sits in the pool.
    assert!(c.antecedent_types.is_empty());
    assert!(c.shared_flows.is_empty());
    assert!(c.flow_loop_stack.is_empty());
    assert!(!c.free_flow_state.is_nil());
    assert!(c.flow_states[c.free_flow_state].next.is_nil());
    assert_eq!(c.flow_states[c.free_flow_state].depth, 0);
    assert!(c.flow_states[c.free_flow_state].reduce_labels.is_empty());
    assert_eq!(c.faults.get(), 0);
    assert!(!c.flow_analysis_disabled);
}

#[test]
fn flow_types_at_loop_labels_use_the_stack_and_the_cache() {
    let ids = IdAllocator::new();
    let arena = Arena::new();
    let open = Open::new(&arena, &ids);
    let frozen = Frozen::none();
    let a = Ast::new(&frozen, &open);
    let options = CompilerOptions::default();
    let mut c = Checker::for_test(a, &options);
    intrinsics(&mut c);
    let mut factory = Factory::new(a);
    let reference = factory.new_keyword_expression(Kind::ThisKeyword);
    let condition = factory.new_keyword_expression(Kind::ThisKeyword);

    let declared = c.new_test_type(TypeFlags::OBJECT);
    let initial = c.new_test_type(TypeFlags::OBJECT);
    let truthy = c.new_test_type(TypeFlags::OBJECT);
    let after_loop = c.new_test_type(TypeFlags::OBJECT);
    c.model.facts.push((initial, TypeFacts::TRUTHY, truthy));
    let both = c.get_union_type(crate::core::List::from_slice(&[initial, truthy]));
    c.model.facts.push((both, TypeFacts::FALSY, after_loop));

    // while (this) {}
    let start = a.new_flow_node(FlowFlags::START, NodeId::NIL, FlowNodeId::NIL);
    let head = a.new_flow_node(FlowFlags::LOOP_LABEL, NodeId::NIL, FlowNodeId::NIL);
    let back = a.new_flow_node(FlowFlags::TRUE_CONDITION, condition, head);
    let antecedents = list(a, &[start, back]);
    a.update_flow(head, |flow| flow.antecedents = antecedents);
    let exit = a.new_flow_node(FlowFlags::FALSE_CONDITION, condition, head);

    let at = |c: &mut Checker<'_>, flow: FlowNodeId| {
        c.get_flow_type_of_reference_ex(reference, declared, initial, NodeId::NIL, flow)
    };
    assert_eq!(c.flow_loop_cache.len(), 0);
    // The back edge sees the initial type as incomplete, narrows it, and the head is the union of both.
    assert_eq!(at(&mut c, exit), after_loop);
    assert_eq!(c.model.last_reduction, UnionReduction::SUBTYPE);
    assert_eq!(c.flow_loop_cache.len(), 1);
    assert!(c.flow_loop_stack.is_empty());
    assert!(c.antecedent_types.is_empty());
    assert!(c.shared_flows.is_empty());
    // The second question is answered from the cache of the loop label.
    assert_eq!(at(&mut c, head), both);
    assert_eq!(at(&mut c, back), both);
    assert_eq!(c.flow_loop_cache.len(), 1);

    // A reference whose declared and initial types are the same stops at the first antecedent, under its own key.
    let same = |c: &mut Checker<'_>, flow: FlowNodeId| {
        c.get_flow_type_of_reference_ex(reference, declared, declared, NodeId::NIL, flow)
    };
    assert_eq!(same(&mut c, head), declared);
    assert_eq!(c.flow_loop_cache.len(), 2);

    // A reference that is not a dotted name has no key: the declared type, and nothing is cached.
    let literal = factory.new_string_literal(b"x", crate::ast::TokenFlags::NONE);
    assert_eq!(
        c.get_flow_type_of_reference_ex(literal, declared, initial, NodeId::NIL, head),
        declared
    );
    assert_eq!(c.flow_loop_cache.len(), 2);
    assert_eq!(c.faults.get(), 0);
}

#[test]
fn flow_analysis_stops_at_two_thousand_levels() {
    let ids = IdAllocator::new();
    let arena = Arena::new();
    let open = Open::new(&arena, &ids);
    let frozen = Frozen::none();
    let a = Ast::new(&frozen, &open);
    let options = CompilerOptions::default();
    let mut c = Checker::for_test(a, &options);
    intrinsics(&mut c);
    let mut factory = Factory::new(a);
    let reference = factory.new_keyword_expression(Kind::ThisKeyword);
    let declared = c.new_test_type(TypeFlags::OBJECT);

    // Each reduce label is one level of getTypeAtFlowNode.
    let chain = |levels: usize| {
        let target = a.new_flow_node(FlowFlags::BRANCH_LABEL, NodeId::NIL, FlowNodeId::NIL);
        let data = new_flow_reduce_label_data(a, target, FlowListId::NIL);
        let mut flow = a.new_flow_node(FlowFlags::START, NodeId::NIL, FlowNodeId::NIL);
        for _ in 0..levels {
            flow = a.new_flow_node(FlowFlags::REDUCE_LABEL, data, flow);
        }
        flow
    };
    let shallow = chain(1999);
    let deep = chain(2000);
    assert_eq!(
        c.get_flow_type_of_reference_ex(reference, declared, declared, NodeId::NIL, shallow),
        declared
    );
    assert!(!c.flow_analysis_disabled);
    assert!(c.model.diagnostics.is_empty());
    assert_eq!(
        c.get_flow_type_of_reference_ex(reference, declared, declared, NodeId::NIL, deep),
        c.error_type
    );
    assert!(c.flow_analysis_disabled);
    // The reference of the test has no block above it: the report falls back to the node itself.
    assert_eq!(
        c.model.diagnostics,
        vec![(
            reference,
            crate::diagnostics::THE_CONTAINING_FUNCTION_OR_MODULE_BODY_IS_TOO_LARGE_FOR_CONTROL_FLOW_ANALYSIS
        )]
    );
    assert_eq!(c.model.added.len(), 1);
    assert_eq!(c.faults.get(), 1);
    // The pool got its state back with every field zero.
    assert!(c.shared_flows.is_empty());
    assert_eq!(c.flow_states[c.free_flow_state].depth, 0);
    assert!(c.flow_states[c.free_flow_state].reduce_labels.is_empty());
    // Further questions are answered with the error type until a block restores the flag.
    assert_eq!(
        c.get_flow_type_of_reference_ex(reference, declared, declared, NodeId::NIL, shallow),
        c.error_type
    );
}
