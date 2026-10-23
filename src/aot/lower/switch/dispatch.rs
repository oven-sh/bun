use core::hash::Hash;

use bun_sema::atom::Atom;
use bun_sema::fold::{Constant, FoldedValue};
use rustc_hash::FxHashSet;

use super::{CaseTest, Subject};
use crate::ir::generated::MAX_TRACKED_INTEGER;
use crate::ir::{BlockId, Edge, StringId, ValueId};
use crate::lower::{FileLowering, FunctionLowering, condition, expression, scope};

const TRACKED_INTEGER_BOUND: f64 = (MAX_TRACKED_INTEGER + 1) as f64;
const SUBJECT_PROOF: [u32; 1] = [0];

#[derive(Copy, Clone, PartialEq, Debug)]
pub(super) enum CaseKey {
    Integer(i64),
    String(Atom),
    Other(Constant),
}

#[derive(Default)]
struct CaseLists {
    integers: Vec<(i64, BlockId)>,
    strings: Vec<(StringId, BlockId)>,
    others: Vec<(Constant, BlockId)>,
}

struct CaseEdge {
    block: BlockId,
    narrowed: Option<ValueId>,
    target: BlockId,
}

impl CaseEdge {
    fn to_edge(&self) -> Edge<'static> {
        match self.narrowed {
            Some(_) => Edge::with_proofs(self.block, &SUBJECT_PROOF),
            None => Edge::to(self.block),
        }
    }
}

pub(super) fn classify_constant(constant: Constant) -> CaseKey {
    match constant {
        Constant::Number(number)
            if number.trunc() == number && number.abs() < TRACKED_INTEGER_BOUND =>
        {
            CaseKey::Integer(number as i64)
        }
        Constant::String(text) => CaseKey::String(text),
        _ => CaseKey::Other(constant),
    }
}

pub(super) fn add_case<K: Copy + Eq + Hash>(
    cases: &mut Vec<(K, BlockId)>,
    seen: &mut FxHashSet<K>,
    key: K,
    target: BlockId,
) {
    if seen.insert(key) {
        cases.push((key, target));
    }
}

pub(super) fn emit_dispatch(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    subject: Subject,
    tests: &[CaseTest],
    default_target: BlockId,
) {
    let mut subject = subject;
    let mut rest = tests;
    while let Some(&first) = rest.first() {
        let is_constant = |test: &&CaseTest| matches!(test.constant, FoldedValue::Constant(_));
        let run_length = rest.iter().take_while(is_constant).count();
        if run_length == 0 {
            emit_evaluated_test(lowering, &mut subject, first);
            rest = &rest[1..];
        } else {
            let (run, after_run) = rest.split_at(run_length);
            emit_constant_run(lowering, &mut subject, run);
            rest = after_run;
        }
    }
    lowering.jump(default_target);
}

fn partition_run(file: &mut FileLowering<'_, '_, '_, '_>, run: &[CaseTest]) -> CaseLists {
    let mut lists = CaseLists::default();
    let mut seen_integers = FxHashSet::default();
    let mut seen_strings = FxHashSet::default();
    for test in run {
        let FoldedValue::Constant(constant) = test.constant else {
            unreachable!("a run contains only constant tests");
        };
        match classify_constant(constant) {
            CaseKey::Integer(integer) => {
                add_case(
                    &mut lists.integers,
                    &mut seen_integers,
                    integer,
                    test.target,
                );
            }
            CaseKey::String(text) => {
                let string = file.intern_atom(text);
                add_case(&mut lists.strings, &mut seen_strings, string, test.target);
            }
            CaseKey::Other(constant) => lists.others.push((constant, test.target)),
        }
    }
    lists
}

fn emit_constant_run(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    subject: &mut Subject,
    run: &[CaseTest],
) {
    let position = lowering.file.hir[run[0].expression].pos;
    lowering.set_position(position);
    let lists = partition_run(lowering.file, run);
    if !lists.integers.is_empty() {
        emit_integer_switch(lowering, subject, &lists.integers);
    }
    if !lists.strings.is_empty() {
        emit_string_switch(lowering, subject, &lists.strings);
    }
    for (constant, target) in lists.others {
        let tested = expression::emit_constant(lowering, constant);
        emit_comparison(lowering, subject, tested, target);
    }
}

fn emit_evaluated_test(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    subject: &mut Subject,
    test: CaseTest,
) {
    match test.constant {
        FoldedValue::Unknown | FoldedValue::ConstantOutsideDeadZone(_) => {}
        FoldedValue::Constant(_) => unreachable!("a constant test belongs to a run"),
    }
    let before = subject
        .local
        .map(|local| scope::read_local(lowering, local));
    let tested = expression::lower_expression(lowering, test.expression);
    let after = subject
        .local
        .map(|local| scope::read_local(lowering, local));
    if before != after {
        subject.local = None;
    }
    let field = subject.field;
    subject.field = field.filter(|&field| condition::is_holder_unchanged(lowering, field));
    let position = lowering.file.hir[test.expression].pos;
    lowering.set_position(position);
    emit_comparison(lowering, subject, tested, test.target);
}

fn create_case_edge(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    subject: &Subject,
    target: BlockId,
) -> CaseEdge {
    if !subject.is_narrowed_on_edges() {
        return CaseEdge {
            block: target,
            narrowed: None,
            target,
        };
    }
    let block = lowering.create_block();
    CaseEdge {
        block,
        narrowed: Some(lowering.builder.add_edge_result(block)),
        target,
    }
}

fn finish_case_edges(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    subject: &Subject,
    edges: &[CaseEdge],
) {
    for edge in edges {
        let Some(narrowed) = edge.narrowed else {
            continue;
        };
        lowering.continue_in(edge.block);
        if let Some(local) = subject.local {
            scope::rebind_local(lowering, local, narrowed);
        }
        if let Some(field) = subject.field {
            condition::narrow_holder(lowering, field, narrowed);
        }
        lowering.jump(edge.target);
    }
}

fn emit_integer_switch(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    subject: &Subject,
    cases: &[(i64, BlockId)],
) {
    let next = lowering.create_block();
    let mut case_edges = Vec::with_capacity(cases.len());
    for &(_, target) in cases {
        case_edges.push(create_case_edge(lowering, subject, target));
    }
    let integers: Vec<i64> = cases.iter().map(|case| case.0).collect();
    let edges: Vec<Edge<'static>> = case_edges.iter().map(CaseEdge::to_edge).collect();
    let otherwise = Edge::to(next);
    lowering
        .builder
        .switch(subject.value, &integers, &edges, otherwise);
    finish_case_edges(lowering, subject, &case_edges);
    lowering.continue_in(next);
}

fn emit_string_switch(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    subject: &Subject,
    cases: &[(StringId, BlockId)],
) {
    let next = lowering.create_block();
    let mut case_edges = Vec::with_capacity(cases.len());
    for &(_, target) in cases {
        case_edges.push(create_case_edge(lowering, subject, target));
    }
    let strings: Vec<StringId> = cases.iter().map(|case| case.0).collect();
    let edges: Vec<Edge<'static>> = case_edges.iter().map(CaseEdge::to_edge).collect();
    let otherwise = Edge::to(next);
    lowering
        .builder
        .switch_string(subject.value, &strings, &edges, otherwise);
    finish_case_edges(lowering, subject, &case_edges);
    lowering.continue_in(next);
}

fn emit_comparison(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    subject: &mut Subject,
    tested: ValueId,
    target: BlockId,
) {
    let is_equal = lowering.builder.strict_eq(subject.value, tested);
    let taken = create_case_edge(lowering, subject, target);
    let next = lowering.create_block();
    if !subject.is_narrowed_on_edges() {
        lowering
            .builder
            .branch(is_equal, taken.to_edge(), Edge::to(next));
        lowering.continue_in(next);
        return;
    }
    let remaining = lowering.builder.add_edge_result(next);
    let not_taken = Edge::with_proofs(next, &SUBJECT_PROOF);
    lowering
        .builder
        .branch(is_equal, taken.to_edge(), not_taken);
    finish_case_edges(lowering, subject, &[taken]);
    lowering.continue_in(next);
    if let Some(local) = subject.local {
        scope::rebind_local(lowering, local, remaining);
    }
    if let Some(field) = subject.field {
        subject.field = condition::narrow_holder(lowering, field, remaining);
    }
    subject.value = remaining;
}
