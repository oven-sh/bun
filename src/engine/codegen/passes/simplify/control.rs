//! Branches and checks, and the code that they cut off.

use bun_engine_asm::Cond;

use super::Simplifier;
use super::rewrite::Step;
use crate::ir::{Binary, Block, Edge, Entity, Exit, Op, Type, Value};

impl Simplifier<'_> {
    /// Returns whether control may get here.
    pub(super) fn enter_block(&mut self) -> bool {
        let (block, incoming) = (self.block, self.cfg.predecessors(self.block));
        if incoming.is_empty() {
            self.tables.entered.insert(block.index());
            self.tables
                .writes
                .enter(self.cfg, self.dominators, block, None);
            return true;
        }
        let is_entered = self.tables.entered.contains(block.index());
        let mut from_outside = incoming.iter().filter(|&&edge| {
            self.function.is_attached(edge)
                && !self.dominators.dominates(block, self.function.source(edge))
        });
        let Some(&first) = from_outside.next() else {
            return false;
        };
        let source = from_outside
            .next()
            .is_none()
            .then(|| self.function.source(first));
        if let Some(source) = source
            && let Op::Branch(condition) = self.op(self.function.last(source))
            && is_entered
        {
            self.decide(condition, first != self.function.successor(source, 0));
        }
        self.tables
            .writes
            .enter(self.cfg, self.dominators, block, source);
        self.would_find_more |= !is_entered;
        if !self.function.params(block).is_empty() {
            self.simplify_params(is_entered);
        }
        true
    }

    pub(super) fn release_args(&mut self, edge: Edge) {
        for position in 0..self.function.args(edge).len() {
            self.release(self.function.args(edge)[position]);
        }
    }

    fn note_loss_of(&mut self, edge: Edge) {
        self.release_args(edge);
        (self.changed_control, self.changed_args_in_loops) = (true, true);
        let target = self.function.target(edge);
        let is_passed = self.dominators.dominates(target, self.block)
            && self.tables.entered.contains(target.index());
        self.would_find_more |= is_passed && !self.function.params(target).is_empty();
    }

    pub(super) fn discard_blocks(&mut self, blocks: &[Block]) {
        self.hit();
        for &block in blocks.iter().rev() {
            self.discard_from_end(block, Value::NONE);
            self.function.remove_block(block);
        }
        self.remove_unused();
    }

    /// Down to `kept`, which stays.
    fn discard_from_end(&mut self, block: Block, kept: Value) {
        for edge in self.function.successors(block) {
            self.note_loss_of(edge);
        }
        self.function.clear_successors(block);
        while self.function.last(block) != kept {
            let last = self.function.last(block);
            self.release_uses_by(last);
            self.function.remove(last);
        }
    }

    pub(super) fn end_block_at(&mut self, value: Value, exit: Exit) {
        self.discard_from_end(self.block, value);
        let origin = self.function.origin(value);
        self.function
            .append(self.block, Op::Unreachable, Type::Void, origin);
        let always = self.constant(Type::I32, 1);
        if let Op::Check(..) = self.op(value) {
            return self.change(value, Op::Check(always, exit));
        }
        self.retain_all(&[always]);
        self.function
            .insert_before(value, Op::Check(always, exit), Type::Void, origin);
        for &operand in self.op(value).inline_operands() {
            self.release(operand);
        }
        self.function.remove(value);
        self.remove_unused();
    }

    pub(super) fn jump_along(&mut self, kept: Edge) {
        let block = self.function.source(kept);
        for edge in self.function.successors(block).filter(|&edge| edge != kept) {
            self.note_loss_of(edge);
        }
        self.release_uses_by(self.function.last(block));
        self.function.keep_only_successor(kept);
        self.remove_unused();
    }

    pub(super) fn visit_end(&mut self, last: Value) {
        self.point_at(last);
        if !matches!(self.op(last), Op::Jump) {
            self.function.resolve_operands(last);
            self.note_writes(last);
            if let Some(position) = self.simplify_end(last) {
                self.jump_along(self.function.successor(self.block, position));
            }
            self.remove_unused();
        }
        self.may_be_untidy = self.may_be_untidy || self.looks_untidy(self.block);
        let is_entered = self.tables.entered.contains(self.block.index());
        for edge in self.function.successors(self.block) {
            if self.function.resolve_args(edge) {
                self.changed_args_in_loops |= !self.cfg.loop_of(self.block).is_none();
            }
            if is_entered {
                self.tables
                    .entered
                    .insert(self.function.target(edge).index());
            }
        }
    }

    /// The position of the only edge that can be taken.
    fn simplify_end(&mut self, last: Value) -> Option<usize> {
        match self.op(last) {
            Op::Branch(mut condition) => {
                while let Some(plainer) = self.plainer_condition(condition) {
                    condition = plainer;
                    self.change(last, Op::Branch(condition));
                }
                let is_zero = self.is_known_zero(condition)?;
                self.hit();
                Some(is_zero.into())
            }
            Op::Switch(value, cases) => {
                let facts = self.facts(value);
                let (width, cases) = (self.type_of(value).width(), self.function.cases(cases));
                let position = match facts.only_value() {
                    Some(key) => cases.iter().position(|&case| case == key),
                    None if cases.iter().all(|&case| facts.excludes(width, case)) => None,
                    None => return None,
                };
                let position = position.unwrap_or(cases.len());
                self.hit();
                Some(position)
            }
            Op::JumpTable(index, cases) => {
                let facts = self.facts(index);
                let cases = self.function.cases(cases);
                let (min, max) = (usize::try_from(facts.min), usize::try_from(facts.max));
                let possible = cases.get(min.unwrap_or(0)..)?.iter();
                let mut possible = possible.take((max.ok()? - min.unwrap_or(0)).saturating_add(1));
                let &first = possible.next()?;
                possible.all(|&other| other == first).then(|| {
                    self.hit();
                    first as usize
                })
            }
            _ => None,
        }
    }

    pub(super) fn check(&mut self, condition: Value, exit: Exit) -> Step {
        match self.is_known_zero(condition) {
            Some(true) => {
                self.hit();
                return Step::Gone;
            }
            Some(false) => {
                self.hit();
                return Step::Exits(exit);
            }
            None => {}
        }
        match self.plainer_condition(condition) {
            Some(plainer) => self.to(Op::Check(plainer, exit)),
            None => Step::Keep,
        }
    }

    /// A value that is zero if and only if `condition` is, in the place of the cursor.
    fn plainer_condition(&mut self, condition: Value) -> Option<Value> {
        if let Some(inner) = self.same_truth(condition) {
            return Some(inner);
        }
        match self.op(condition) {
            Op::Binary(Binary::Xor, [inner, one])
                if self.int(one) == Some(1) && self.is_boolean(inner) =>
            {
                self.hit();
                let zero = self.int_like(inner, 0);
                Some(self.make_as_it_is(Op::Compare(Cond::Eq, [inner, zero]), Type::I32))
            }
            Op::Binary(op @ (Binary::Or | Binary::And), [a, b]) => {
                [(a, b), (b, a)].into_iter().find_map(|(decided, other)| {
                    let is_neutral = self.decision(decided)? == (op == Binary::Or)
                        && (op == Binary::Or || self.is_boolean(a) && self.is_boolean(b));
                    is_neutral.then(|| {
                        self.hit();
                        other
                    })
                })
            }
            _ => None,
        }
    }

    /// From here on down the subtree.
    pub(super) fn decide(&mut self, condition: Value, is_zero: bool) {
        const DEPTH: u32 = 3;
        self.decide_within(condition, is_zero, DEPTH);
    }

    fn decide_within(&mut self, condition: Value, is_zero: bool, depth: u32) {
        let info = &mut self.tables.values[condition];
        if info.decided_until > self.position {
            return;
        }
        (info.decided_until, info.is_zero) = (self.end_of_subtree, is_zero);
        if let Op::Compare(_, [a, _]) | Op::FloatCompare(_, [a, _]) = self.op(condition) {
            self.tables.values[a].is_compared = true;
        }
        let Some(depth) = depth.checked_sub(1) else {
            return;
        };
        match (self.op(condition), is_zero) {
            (Op::Compare(Cond::Eq, [inner, zero]), _) if self.int(zero) == Some(0) => {
                self.decide_within(inner, !is_zero, depth);
            }
            (Op::Compare(Cond::Ne, [inner, zero]), _) if self.int(zero) == Some(0) => {
                self.decide_within(inner, is_zero, depth);
            }
            (Op::Binary(Binary::Or, [a, b]), true) | (Op::Binary(Binary::And, [a, b]), false) => {
                self.decide_within(a, is_zero, depth);
                self.decide_within(b, is_zero, depth);
            }
            _ => {}
        }
    }

    /// Whether the value is zero, according to the branches and checks above.
    fn decision(&mut self, value: Value) -> Option<bool> {
        let recorded = |this: &Self, value: Value| {
            let info = this.tables.values[value];
            (info.decided_until > this.position).then_some(info.is_zero)
        };
        if let Some(is_zero) = recorded(self, value) {
            return Some(is_zero);
        }
        let opposite = match self.op(value) {
            Op::Binary(op @ (Binary::And | Binary::Or), args) => {
                let settles = Some(op == Binary::And);
                return args
                    .iter()
                    .any(|&arg| recorded(self, arg) == settles)
                    .then(|| {
                        self.hit();
                        op == Binary::And
                    });
            }
            Op::Compare(cond @ (Cond::Eq | Cond::Ne), [inner, zero])
                if self.int(zero) == Some(0) && recorded(self, inner).is_some() =>
            {
                self.hit();
                return recorded(self, inner).map(|is_zero| is_zero == (cond == Cond::Ne));
            }
            Op::Compare(_, [a, _]) | Op::FloatCompare(_, [a, _])
                if !self.tables.values[a].is_compared =>
            {
                return None;
            }
            Op::Compare(cond, args) => Op::Compare(cond.inverted(), args),
            Op::FloatCompare(cond, args) => Op::FloatCompare(cond.inverted(), args),
            _ => return None,
        };
        let is_zero = recorded(self, self.find_expression(&opposite, Type::I32).ok()?)?;
        self.hit();
        Some(!is_zero)
    }

    fn is_known_zero(&mut self, condition: Value) -> Option<bool> {
        if !matches!(self.op(condition), Op::Compare(..) | Op::FloatCompare(..)) {
            let facts = self.facts(condition);
            if facts.is_not_zero() || facts.possible() == 0 {
                return Some(facts.possible() == 0);
            }
        }
        self.decision(condition)
    }
}
