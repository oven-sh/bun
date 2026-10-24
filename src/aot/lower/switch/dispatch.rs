use core::hash::Hash;

use bun_sema::atom::Atom;
use bun_sema::fold::{Constant, FoldedValue};
use rustc_hash::FxHashSet;

use super::{CaseTest, Subject};
use crate::ir::generated::MAX_TRACKED_INTEGER;
use crate::ir::{BlockId, Edge, StringId, ValueId};
use crate::lower::{FileLowering, FunctionLowering};

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

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(super) fn emit_dispatch(
        &mut self,
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
                self.emit_evaluated_test(&mut subject, first);
                rest = &rest[1..];
            } else {
                let (run, after_run) = rest.split_at(run_length);
                self.emit_constant_run(&mut subject, run);
                rest = after_run;
            }
        }
        self.jump(default_target);
    }

    fn emit_constant_run(&mut self, subject: &mut Subject, run: &[CaseTest]) {
        let position = self.file.hir[run[0].expression].pos;
        self.set_position(position);
        let lists = self.file.partition_run(run);
        if !lists.integers.is_empty() {
            self.emit_integer_switch(subject, &lists.integers);
        }
        if !lists.strings.is_empty() {
            self.emit_string_switch(subject, &lists.strings);
        }
        for (constant, target) in lists.others {
            let tested = self.emit_constant(constant);
            emit_comparison(self, subject, tested, target);
        }
    }

    fn emit_evaluated_test(&mut self, subject: &mut Subject, test: CaseTest) {
        match test.constant {
            FoldedValue::Unknown | FoldedValue::ConstantOutsideDeadZone(_) => {}
            FoldedValue::Constant(_) => unreachable!("a constant test belongs to a run"),
        }
        let before = subject.local.map(|local| self.read_local(local));
        let tested = self.lower_expression(test.expression);
        let after = subject.local.map(|local| self.read_local(local));
        if before != after {
            subject.local = None;
        }
        let field = subject.field;
        subject.field = field.filter(|&field| self.is_holder_unchanged(field));
        let position = self.file.hir[test.expression].pos;
        self.set_position(position);
        emit_comparison(self, subject, tested, test.target);
    }

    fn create_case_edge(&mut self, subject: &Subject, target: BlockId) -> CaseEdge {
        if !subject.is_narrowed_on_edges() {
            return CaseEdge {
                block: target,
                narrowed: None,
                target,
            };
        }
        let block = self.create_block();
        CaseEdge {
            block,
            narrowed: Some(self.builder.add_edge_result(block)),
            target,
        }
    }

    fn finish_case_edges(&mut self, subject: &Subject, edges: &[CaseEdge]) {
        for edge in edges {
            let Some(narrowed) = edge.narrowed else {
                continue;
            };
            self.continue_in(edge.block);
            if let Some(local) = subject.local {
                self.rebind_local(local, narrowed);
            }
            if let Some(field) = subject.field {
                self.narrow_holder(field, narrowed);
            }
            self.jump(edge.target);
        }
    }

    fn emit_integer_switch(&mut self, subject: &Subject, cases: &[(i64, BlockId)]) {
        let next = self.create_block();
        let mut case_edges = Vec::with_capacity(cases.len());
        for &(_, target) in cases {
            case_edges.push(self.create_case_edge(subject, target));
        }
        let integers: Vec<i64> = cases.iter().map(|case| case.0).collect();
        let edges: Vec<Edge<'static>> = case_edges.iter().map(CaseEdge::to_edge).collect();
        let otherwise = Edge::to(next);
        self.builder
            .switch(subject.value, &integers, &edges, otherwise);
        self.finish_case_edges(subject, &case_edges);
        self.continue_in(next);
    }

    fn emit_string_switch(&mut self, subject: &Subject, cases: &[(StringId, BlockId)]) {
        let next = self.create_block();
        let mut case_edges = Vec::with_capacity(cases.len());
        for &(_, target) in cases {
            case_edges.push(self.create_case_edge(subject, target));
        }
        let strings: Vec<StringId> = cases.iter().map(|case| case.0).collect();
        let edges: Vec<Edge<'static>> = case_edges.iter().map(CaseEdge::to_edge).collect();
        let otherwise = Edge::to(next);
        self.builder
            .switch_string(subject.value, &strings, &edges, otherwise);
        self.finish_case_edges(subject, &case_edges);
        self.continue_in(next);
    }
}

impl FileLowering<'_, '_, '_, '_> {
    fn partition_run(&mut self, run: &[CaseTest]) -> CaseLists {
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
                    let string = self.intern_atom(text);
                    add_case(&mut lists.strings, &mut seen_strings, string, test.target);
                }
                CaseKey::Other(constant) => lists.others.push((constant, test.target)),
            }
        }
        lists
    }
}

fn emit_comparison(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    subject: &mut Subject,
    tested: ValueId,
    target: BlockId,
) {
    let is_equal = lowering.builder.strict_eq(subject.value, tested);
    let taken = lowering.create_case_edge(subject, target);
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
    lowering.finish_case_edges(subject, &[taken]);
    lowering.continue_in(next);
    if let Some(local) = subject.local {
        lowering.rebind_local(local, remaining);
    }
    if let Some(field) = subject.field {
        subject.field = lowering.narrow_holder(field, remaining);
    }
    subject.value = remaining;
}
