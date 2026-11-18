//! Turns a chain of tests of one value for equality with constants into a switch.

use bun_engine_asm::Cond;

use super::Analyses;
use crate::analysis::Cfg;
use crate::bitset::BitSet;
use crate::ir::{Block, Edge, Entity, Function, Op, Value};
use crate::target::Target;

/// Fewer are tested one after the other anyway, and the order they have may be the best.
const LEAST_KEYS: usize = 4;

struct Case {
    key: i64,
    edge: Edge,
    is_rare: bool,
}

/// The end of a block, seen as a switch.
#[derive(Clone, Copy)]
struct Test {
    subject: Value,
    /// For a branch.
    only_case: Option<(i64, Edge)>,
    default: Edge,
}

pub(super) fn run(function: &mut Function, analyses: &mut Analyses, _: Target) {
    let cfg = analyses.cfg(function);
    let mut absorbed = BitSet::with_size(function.block_count());
    let (mut chain, mut cases) = (Vec::new(), Vec::new());
    let mut changed = false;
    for &head in cfg.order() {
        if absorbed.contains(head.index()) {
            continue;
        }
        let Some(first) = test_at_end(function, head) else {
            continue;
        };
        chain.clear();
        let mut last = first;
        while let Some(next) = continuation(function, cfg, last) {
            chain.push(function.target(last.default));
            last = next;
        }
        if chain.is_empty() {
            continue;
        }
        let default = collect_cases(function, head, &chain, &mut cases);
        if cases.len() < LEAST_KEYS {
            continue;
        }
        let end = function.last(head);
        for &block in &chain {
            absorbed.insert(block.index());
            if function.first(block) != function.last(block) {
                function.move_before(function.first(block), end);
            }
        }
        let keys = function.add_cases(cases.iter().map(|case| case.key));
        *function.op_mut(end) = Op::Switch(first.subject, keys);
        function.clear_successors(head);
        for case in cases.iter().chain([&default]) {
            let edge = function.push_copy_of(head, case.edge);
            function.set_rare(edge, case.is_rare);
        }
        changed = true;
    }
    if changed {
        analyses.invalidate();
    }
}

fn test_at_end(function: &Function, block: Block) -> Option<Test> {
    let edge = |position| function.successor(block, position);
    match *function.op(function.last(block)) {
        Op::Switch(subject, cases) => Some(Test {
            subject,
            only_case: None,
            default: edge(function.cases(cases).len()),
        }),
        Op::Branch(condition) => {
            let (subject, key, matching) = match *function.op(condition) {
                Op::Compare(cond @ (Cond::Eq | Cond::Ne), [subject, key]) => (
                    subject,
                    function.int_constant(key)?,
                    usize::from(cond == Cond::Ne),
                ),
                _ => (condition, 0, 1),
            };
            Some(Test {
                subject,
                only_case: Some((key, edge(matching))),
                default: edge(1 - matching),
            })
        }
        _ => None,
    }
}

/// The test in the block that only the default leads to, if it does nothing but test the same value.
fn continuation(function: &Function, cfg: &Cfg, test: Test) -> Option<Test> {
    let block = function.target(test.default);
    if cfg.predecessors(block).len() != 1 || !function.params(block).is_empty() {
        return None;
    }
    let (first, last) = (function.first(block), function.last(block));
    let only_tests =
        first == last || function.next(first) == last && *function.op(last) == Op::Branch(first);
    test_at_end(function, block).filter(|next| only_tests && next.subject == test.subject)
}

/// Returns the default.
fn collect_cases(function: &Function, head: Block, chain: &[Block], cases: &mut Vec<Case>) -> Case {
    cases.clear();
    let mut default = Case {
        key: 0,
        edge: Edge::NONE,
        is_rare: false,
    };
    for &block in core::iter::once(&head).chain(chain) {
        let test = test_at_end(function, block).expect("the chain has only tests");
        let mut add = |(key, edge)| {
            let is_rare = default.is_rare || function.is_rare(edge);
            cases.push(Case { key, edge, is_rare });
        };
        match (test.only_case, *function.op(function.last(block))) {
            (Some(case), _) => add(case),
            (None, Op::Switch(_, keys)) => {
                let keys = function.cases(keys).iter().copied();
                keys.zip(function.successors(block)).for_each(add);
            }
            _ => unreachable!("neither a branch nor a switch"),
        }
        default.edge = test.default;
        default.is_rare |= function.is_rare(test.default);
    }
    cases.sort_by_key(|case| case.key);
    cases.dedup_by_key(|case| case.key);
    default
}
