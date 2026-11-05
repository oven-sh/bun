use core::hash::Hash;

use bun_sema::atom::Atom;
use bun_sema::fold::{Constant, FoldedValue};
use rustc_hash::FxHashSet;

use super::{CaseTest, Subject};
use crate::ir::generated::MAX_TRACKED_INTEGER;
use crate::ir::{BlockId, Edge, FunctionBuilder, ValueId};
use crate::lower::FunctionLowering;

const TRACKED_INTEGER_BOUND: f64 = (MAX_TRACKED_INTEGER + 1) as f64;
const SUBJECT_PROOF: [u32; 1] = [0];

#[derive(Copy, Clone, PartialEq, Debug)]
pub(super) enum CaseKey {
    Integer(i64),
    String(Atom),
    Other(Constant),
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
        mut subject: Subject,
        mut rest: &[CaseTest],
        default_target: BlockId,
    ) {
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
        let (mut integers, mut strings, mut others) = (Vec::new(), Vec::new(), Vec::new());
        let (mut seen_integers, mut seen_strings) = (FxHashSet::default(), FxHashSet::default());
        for test in run {
            let FoldedValue::Constant(constant) = test.constant else {
                unreachable!("a run contains only constant tests");
            };
            match classify_constant(constant) {
                CaseKey::Integer(integer) => {
                    add_case(&mut integers, &mut seen_integers, integer, test.target);
                }
                CaseKey::String(text) => {
                    let string = self.file.intern_atom(text);
                    add_case(&mut strings, &mut seen_strings, string, test.target);
                }
                CaseKey::Other(constant) => others.push((constant, test.target)),
            }
        }
        let value = subject.value;
        self.emit_table_switch(subject, &integers, |builder, keys, edges, otherwise| {
            builder.switch(value, keys, edges, otherwise);
        });
        self.emit_table_switch(subject, &strings, |builder, keys, edges, otherwise| {
            builder.switch_string(value, keys, edges, otherwise);
        });
        for (constant, target) in others {
            let tested = self.emit_constant(constant);
            self.emit_comparison(subject, tested, target);
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
        self.emit_comparison(subject, tested, test.target);
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

    fn emit_table_switch<K: Copy>(
        &mut self,
        subject: &Subject,
        cases: &[(K, BlockId)],
        emit: impl FnOnce(&mut FunctionBuilder, &[K], &[Edge<'static>], Edge<'static>),
    ) {
        if cases.is_empty() {
            return;
        }
        let next = self.create_block();
        let mut case_edges = Vec::with_capacity(cases.len());
        for &(_, target) in cases {
            case_edges.push(self.create_case_edge(subject, target));
        }
        let keys: Vec<K> = cases.iter().map(|case| case.0).collect();
        let edges: Vec<Edge<'static>> = case_edges.iter().map(CaseEdge::to_edge).collect();
        emit(&mut self.builder, &keys, &edges, Edge::to(next));
        self.finish_case_edges(subject, &case_edges);
        self.continue_in(next);
    }

    fn emit_comparison(&mut self, subject: &mut Subject, tested: ValueId, target: BlockId) {
        let is_equal = self.builder.strict_eq(subject.value, tested);
        let taken = self.create_case_edge(subject, target);
        let next = self.create_block();
        if !subject.is_narrowed_on_edges() {
            self.builder
                .branch(is_equal, taken.to_edge(), Edge::to(next));
            self.continue_in(next);
            return;
        }
        let remaining = self.builder.add_edge_result(next);
        let not_taken = Edge::with_proofs(next, &SUBJECT_PROOF);
        self.builder.branch(is_equal, taken.to_edge(), not_taken);
        self.finish_case_edges(subject, &[taken]);
        self.continue_in(next);
        if let Some(local) = subject.local {
            self.rebind_local(local, remaining);
        }
        if let Some(field) = subject.field {
            subject.field = self.narrow_holder(field, remaining);
        }
        subject.value = remaining;
    }
}
