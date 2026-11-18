//! Makes use of what the branches, switches and checks on the way to an instruction have found.

use bun_engine_asm::Cond;

use super::Analyses;
use super::bounds::Bounds;
use super::facts::{Facts, Mark};
use super::induction::Turns;
use super::preheaders::entering_edges;
use super::readability::{withdraw_promise, withdraw_promises};
use crate::analysis::{Cfg, Dominators};
use crate::bitset::BitSet;
use crate::ir::{
    AccessFlags, Binary, Block, Cases, Checked, Edge, Entity, Function, Op, State, Type, Value,
};
use crate::target::Target;

const MOST_KEYS_EXCLUDED: usize = 8;

struct Folding<'a> {
    cfg: &'a Cfg,
    dominators: &'a Dominators,
    facts: Facts<'a>,
    never_taken: BitSet,
    switches_to_prune: Vec<Block>,
    /// They have the value that they had only here.
    changed: Vec<Value>,
    made_aliases: bool,
    removed_edges: bool,
}

pub(super) fn run(function: &mut Function, analyses: &mut Analyses, _: Target) {
    let (cfg, dominators) = analyses.dominators(function);
    let mut folding = Folding {
        cfg,
        dominators,
        facts: Facts::new(function, cfg),
        never_taken: BitSet::with_size(function.edge_count()),
        switches_to_prune: Vec::new(),
        changed: Vec::new(),
        made_aliases: false,
        removed_edges: false,
    };
    let mut scopes: Vec<(Block, Mark)> = Vec::new();
    for &block in dominators.pre_order() {
        while let Some((_, mark)) = scopes.pop_if(|scope| !dominators.dominates(scope.0, block)) {
            folding.facts.forget_since(mark);
        }
        scopes.push((block, folding.facts.mark()));
        folding.visit(function, block);
    }
    if !folding.changed.is_empty() {
        withdraw_promises(function, cfg, &folding.changed);
    }
    for &block in &folding.switches_to_prune {
        folding.prune_switch(function, block);
    }
    if folding.made_aliases {
        for state in (0..function.state_count()).map(State::from_index) {
            function.resolve_state(state);
        }
    }
    if folding.removed_edges {
        analyses.invalidate();
    }
}

/// The collector finds addresses in registers and frames, but not in code.
fn may_be_address(ty: Type, constant: i64) -> bool {
    const ADDRESSES: core::ops::Range<i64> = 1 << 16..1 << 56;
    ty == Type::I64 && ADDRESSES.contains(&constant)
}

fn position_among_successors(function: &Function, edge: Edge) -> usize {
    edge.index() - function.successor(function.source(edge), 0).index()
}

impl Folding<'_> {
    fn visit(&mut self, function: &mut Function, block: Block) {
        if !self.enter(function, block) {
            for edge in function.successors(block) {
                self.never_taken.insert(edge.index());
            }
            return;
        }
        let mut value = function.first(block);
        while !value.is_none() {
            let next = function.next(value);
            self.replace_operands(function, value);
            self.fold(function, value);
            value = next;
        }
        for edge in function.successors(block) {
            for position in 0..function.args(edge).len() {
                if let Some(better) = self.replacement(function, function.args(edge)[position]) {
                    function.args_mut(edge)[position] = better;
                    let param = function.params(function.target(edge))[position];
                    self.changed.push(param);
                }
            }
        }
    }

    /// Returns whether control can get to the block.
    fn enter(&mut self, function: &Function, block: Block) -> bool {
        let mut ways = self.cfg.predecessors(block);
        if ways.is_empty() {
            return true;
        }
        let natural = self
            .cfg
            .loop_headed_by(block)
            .filter(|&id| self.cfg.loops()[id].is_natural);
        if let Some(id) = natural {
            ways = entering_edges(function, self.cfg, id);
        }
        let mut open = ways
            .iter()
            .filter(|edge| !self.never_taken.contains(edge.index()));
        match (open.next(), open.next()) {
            (None, _) => return false,
            (Some(&only), None) => self.learn_from_edge(function, only),
            _ => self.learn_from_cases(function, ways),
        }
        if let (Some(id), &[entering]) = (natural, ways) {
            let turns = Turns {
                cfg: self.cfg,
                dominators: self.dominators,
                id,
                entering,
                returning: &self.cfg.predecessors(block)[1..],
            };
            turns.learn(function, &mut self.facts);
        }
        true
    }

    fn learn_from_edge(&mut self, function: &Function, edge: Edge) {
        let position = position_among_successors(function, edge);
        match *function.op(function.last(function.source(edge))) {
            Op::Branch(condition) => {
                self.facts
                    .learn_whether_zero(function, condition, position == 1);
            }
            Op::Switch(subject, cases) if position == function.cases(cases).len() => {
                let width = function.type_of(subject).width();
                let mut bounds = self.facts.bounds(function, subject);
                for &key in function.cases(cases).iter().take(MOST_KEYS_EXCLUDED) {
                    if !bounds.is_empty() {
                        bounds = bounds.where_holds(Cond::Ne, &Bounds::constant(width, key));
                    }
                }
                self.facts.learn_bounds(function, subject, bounds);
            }
            Op::Switch(..) => self.learn_from_cases(function, &[edge]),
            _ => {}
        }
    }

    /// If all edges are cases of one switch.
    fn learn_from_cases(&mut self, function: &Function, edges: &[Edge]) {
        let source = function.source(edges[0]);
        let Op::Switch(subject, cases) = *function.op(function.last(source)) else {
            return;
        };
        let (mut least, mut greatest) = (i64::MAX, i64::MIN);
        for &edge in edges {
            if function.source(edge) != source {
                return;
            }
            let keys = function.cases(cases);
            let Some(&key) = keys.get(position_among_successors(function, edge)) else {
                return;
            };
            (least, greatest) = (least.min(key), greatest.max(key));
        }
        let keys = Bounds::signed(function.type_of(subject).width(), least, greatest);
        let bounds = self.facts.bounds(function, subject).intersection(&keys);
        self.facts.learn_bounds(function, subject, bounds);
    }

    #[inline]
    fn replacement(&self, function: &mut Function, value: Value) -> Option<Value> {
        let resolved = function.resolve(value);
        match self.facts.constant(resolved) {
            Some(constant) if !may_be_address(function.type_of(resolved), constant) => {
                Some(function.constant(function.type_of(resolved), constant as u64))
            }
            _ => (resolved != value).then_some(resolved),
        }
    }

    #[inline]
    fn replace_operands(&mut self, function: &mut Function, user: Value) {
        for position in 0..function.operands(user).len() {
            if let Some(better) = self.replacement(function, function.operands(user)[position]) {
                function.operands_mut(user)[position] = better;
                let access = function.op(user).access();
                if access.is_some_and(|access| access.has(AccessFlags::ALWAYS_READABLE)) {
                    withdraw_promise(function, user);
                }
                self.changed.push(user);
            }
        }
    }

    fn replace(&mut self, function: &mut Function, value: Value, replacement: Value) {
        function.replace(value, replacement);
        self.made_aliases = true;
    }

    fn fold(&mut self, function: &mut Function, value: Value) {
        match *function.op(value) {
            Op::Compare(..) | Op::FloatCompare(..) => {
                if let Some(holds) = self.facts.decide(function, value) {
                    let result = function.const32(holds.into());
                    self.replace(function, value, result);
                }
            }
            Op::Select([condition, then, or]) => {
                if let Some(holds) = self.facts.is_not_zero(function, condition) {
                    self.replace(function, value, if holds { then } else { or });
                }
            }
            Op::Check(condition, exit) => match self.facts.is_not_zero(function, condition) {
                Some(false) => function.remove(value),
                Some(true) => *function.op_mut(value) = Op::Check(function.const32(1), exit),
                None => self.facts.learn_whether_zero(function, condition, true),
            },
            Op::Checked(op, [a, b], _) => {
                let bounds = [a, b].map(|operand| self.facts.bounds(function, operand));
                if Bounds::always_fits(op, &bounds[0], &bounds[1]) {
                    let plain = match op {
                        Checked::Add => Binary::Add,
                        Checked::Sub => Binary::Sub,
                        Checked::Mul => Binary::Mul,
                    };
                    *function.op_mut(value) = Op::Binary(plain, [a, b]);
                    self.changed.push(value);
                }
            }
            Op::Binary(op @ (Binary::TotalDiv | Binary::TotalRem), [a, b]) => {
                let [dividend, divisor] =
                    [a, b].map(|operand| self.facts.bounds(function, operand));
                let least = Bounds::any(function.type_of(value).width()).least;
                if !divisor.contains(0) && !(divisor.contains(-1) && dividend.contains(least)) {
                    let partial = if op == Binary::TotalDiv {
                        Binary::Div
                    } else {
                        Binary::Rem
                    };
                    *function.op_mut(value) = Op::Binary(partial, [a, b]);
                }
            }
            Op::Branch(condition) => {
                if let Some(holds) = self.facts.is_not_zero(function, condition) {
                    self.always_take(function, value, usize::from(!holds));
                }
            }
            Op::Switch(subject, cases) => self.fold_switch(function, value, subject, cases),
            Op::JumpTable(index, cases) => {
                if let Some(index) = function.int_constant(index)
                    && let Some(&position) = function.cases(cases).get(index as u32 as usize)
                {
                    self.always_take(function, value, position as usize);
                }
            }
            _ => {}
        }
    }

    fn always_take(&mut self, function: &mut Function, end: Value, position: usize) {
        let block = function.block_of(end);
        let taken = function.successor(block, position);
        for edge in function.successors(block).filter(|&edge| edge != taken) {
            self.never_taken.insert(edge.index());
        }
        function.keep_only_successor(taken);
        self.removed_edges = true;
    }

    fn fold_switch(&mut self, function: &mut Function, end: Value, subject: Value, cases: Cases) {
        let bounds = self.facts.bounds(function, subject);
        let (keys, block) = (function.cases(cases), function.block_of(end));
        let possible = keys.iter().filter(|&&key| bounds.contains(key)).count();
        if possible == 0 || bounds.only_value().is_some() {
            let found = keys.iter().position(|&key| bounds.contains(key));
            self.always_take(function, end, found.unwrap_or(keys.len()));
        } else if possible < keys.len() {
            for (&key, edge) in keys.iter().zip(function.successors(block)) {
                if !bounds.contains(key) {
                    self.never_taken.insert(edge.index());
                }
            }
            self.switches_to_prune.push(block);
            self.removed_edges = true;
        }
    }

    fn prune_switch(&self, function: &mut Function, block: Block) {
        let end = function.last(block);
        let Op::Switch(subject, cases) = *function.op(end) else {
            unreachable!("not a switch")
        };
        let edges = function.successors(block);
        let is_kept = |edge: &Edge| !self.never_taken.contains(edge.index());
        let keys = function.cases(cases).iter().zip(edges.clone());
        let kept: Vec<i64> = keys
            .filter(|(_, edge)| is_kept(edge))
            .map(|(&key, _)| key)
            .collect();
        *function.op_mut(end) = Op::Switch(subject, function.add_cases(kept));
        function.clear_successors(block);
        for edge in edges.filter(is_kept) {
            function.push_copy_of(block, edge);
        }
    }
}
