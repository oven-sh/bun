//! Conditions that branches, checks and selections evaluate themselves.

use bun_engine_asm::arm64::{Cc, FloatFlags, Select};
use bun_engine_asm::{Cond, FloatCond, VectorReduce, Width};
use smallvec::SmallVec;

use super::comparison::{Comparison, Form, flags_for};
use super::instruction::{Inst, Test, ZERO};
use crate::ir::{Binary, Op, Unary, Value};
use crate::machine::Lowering;

const MOST_TERMS: usize = 5;
const MOST_STEPS: u32 = 8;
const DEPTH_OF_BOOLEANS: u32 = 4;

/// Whether a value is not zero, or the opposite.
#[derive(Clone, Copy)]
struct Truth {
    value: Value,
    is_inverted: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Join {
    And,
    Or,
}

/// A comparison that is joined to the outcome of those before it.
pub(super) type Term = (Join, Comparison);

/// The terms after the first are the last ones in `Selection::terms`.
#[derive(Clone, Copy)]
pub(super) struct Condition {
    first: Comparison,
    more_terms: usize,
    pub(super) flags: FloatFlags,
}

impl Condition {
    fn direct_test(&self) -> Option<(Test, [Value; 2])> {
        self.first.direct_test().filter(|_| self.more_terms == 0)
    }
}

fn one(flags: FloatFlags) -> Cc {
    match flags {
        FloatFlags::One(cc) => cc,
        FloatFlags::Either(..) => unreachable!("takes two tests"),
    }
}

impl Lowering<'_, Inst> {
    /// Looks through what only passes a truth on or inverts it. `is_alone` is cleared if that has other uses.
    fn peel(&self, mut truth: Truth, is_alone: &mut bool) -> Truth {
        for _ in 0..MOST_STEPS {
            let (inner, inverts) = match self.op(truth.value) {
                _ if !self.can_repeat(truth.value) => break,
                Op::Compare(cond @ (Cond::Eq | Cond::Ne), [lhs, rhs]) if self.is_zero(rhs) => {
                    (lhs, cond == Cond::Eq)
                }
                Op::Binary(Binary::Xor, [lhs, rhs])
                    if self.int_constant(rhs) == Some(1)
                        && self.is_boolean(lhs, DEPTH_OF_BOOLEANS) =>
                {
                    (lhs, true)
                }
                Op::Unary(Unary::Widen(_), narrow) => (narrow, false),
                _ => break,
            };
            *is_alone &= self.use_count(truth.value) == 1;
            truth = Truth {
                value: inner,
                is_inverted: truth.is_inverted != inverts,
            };
        }
        truth
    }

    fn split(&self, truth: Truth) -> Option<(Join, [Truth; 2])> {
        let (is_and, parts) = match self.op(truth.value) {
            Op::Binary(Binary::Or, parts) => (false, parts),
            Op::Binary(Binary::And, parts)
                if parts
                    .iter()
                    .all(|&part| self.is_boolean(part, DEPTH_OF_BOOLEANS)) =>
            {
                (true, parts)
            }
            _ => return None,
        };
        let join = if is_and != truth.is_inverted {
            Join::And
        } else {
            Join::Or
        };
        let parts = parts.map(|value| Truth { value, ..truth });
        self.has_one_use_nearby(truth.value)
            .then_some((join, parts))
    }

    /// The instructions that it takes to get the value, which a comparison does without.
    fn cost_of_value(&self, value: Value) -> u32 {
        match self.op(value) {
            _ if !self.has_one_use_nearby(value) => 0,
            Op::Compare(..) | Op::FloatCompare(..) => 2,
            Op::Binary(Binary::Xor | Binary::Sub | Binary::Add, _) => 1,
            _ => 0,
        }
    }

    /// The last term comes first.
    fn gather_terms(&self, root: Truth, gain: &mut u32) -> SmallVec<[(Join, Truth); MOST_TERMS]> {
        let mut terms = SmallVec::new();
        let mut nested = self.split(root);
        while let Some((join, parts)) = nested.take() {
            let mut pending: SmallVec<[Truth; MOST_TERMS]> = SmallVec::from_slice(&parts);
            while let Some(part) = pending.pop() {
                let mut is_alone = true;
                let peeled = self.peel(part, &mut is_alone);
                let known = terms.len() + pending.len() + 2 * usize::from(nested.is_some());
                let has_room = is_alone && known + 2 <= MOST_TERMS;
                match self.split(peeled).filter(|_| has_room) {
                    Some((inner, parts)) if inner == join => pending.extend(parts),
                    Some(other) if nested.is_none() => nested = Some(other),
                    _ => {
                        let costs = [part, peeled].map(|truth| self.cost_of_value(truth.value));
                        *gain += costs[0].max(costs[1]);
                        terms.push((join, peeled));
                    }
                }
            }
        }
        terms
    }

    fn takes_two_tests(&self, value: Value) -> bool {
        matches!(
            self.op(value),
            Op::FloatCompare(FloatCond::Ne | FloatCond::EqOrUnordered, _)
        )
    }

    fn match_chain(&mut self, root: Truth, least_gain: u32) -> Option<Condition> {
        let mut gain = 0;
        let mut terms = self.gather_terms(root, &mut gain);
        if gain < least_gain
            || terms
                .iter()
                .any(|(_, truth)| self.takes_two_tests(truth.value))
        {
            return None;
        }
        terms.reverse();
        let innermost = terms.iter().take_while(|term| term.0 == terms[0].0).count();
        if let Some(first) =
            (0..innermost).find(|&index| self.needs_unconditional_form(terms[index].1.value))
        {
            terms.swap(0, first);
        }
        let mut condition = self.match_one(terms[0].1);
        for &(join, truth) in &terms[1..] {
            let term = self.match_truth(truth.value, Form::Conditional);
            let term = term.inverted_if(truth.is_inverted);
            self.selection.terms.push((join, term));
            condition.more_terms += 1;
            condition.flags = term.flags;
        }
        Some(condition)
    }

    fn match_one(&mut self, truth: Truth) -> Condition {
        let comparison = self.match_truth(truth.value, Form::Any);
        let first = comparison.inverted_if(truth.is_inverted);
        Condition {
            first,
            more_terms: 0,
            flags: first.flags,
        }
    }

    fn match_peeled(&mut self, truth: Truth, is_alone: bool) -> Condition {
        if is_alone
            && self.split(truth).is_some()
            && let Some(chain) = self.match_chain(truth, 2)
        {
            return chain;
        }
        self.match_one(truth)
    }

    /// For an instruction that reads the flags. `finish_condition` follows it.
    pub(super) fn match_condition(&mut self, value: Value) -> Condition {
        let (mut is_alone, is_inverted) = (true, false);
        let truth = self.peel(Truth { value, is_inverted }, &mut is_alone);
        self.match_peeled(truth, is_alone)
    }

    pub(super) fn finish_condition(&mut self, condition: &Condition) {
        for left in (0..condition.more_terms).rev() {
            let (join, term) = self.selection.terms.pop().unwrap();
            let before = match self.selection.terms.last() {
                Some(&(_, before)) if left != 0 => before,
                _ => condition.first,
            };
            let (before, own) = (one(before.flags), one(term.flags));
            let (or, cc) = match join {
                Join::And => (flags_for(own.inverted()), before),
                Join::Or => (flags_for(own), before.inverted()),
            };
            self.finish_conditional_setter(term.setter, or, cc);
        }
        self.finish_comparison(condition.first);
    }

    /// Gives the operands of the test, has `finish` end the instruction that jumps, and sets the flags before it.
    pub(super) fn select_jump(&mut self, value: Value, finish: impl FnOnce(&mut Self, Test)) {
        let (mut is_alone, is_inverted) = (true, false);
        let truth = self.peel(Truth { value, is_inverted }, &mut is_alone);
        if let Op::VectorReduce(VectorReduce::AnyTrue, vector) = self.op(truth.value)
            && self.can_repeat(truth.value)
        {
            self.use_register(vector);
            let test = if truth.is_inverted {
                Test::VectorZero
            } else {
                Test::VectorNotZero
            };
            return finish(self, test);
        }
        let condition = self.match_peeled(truth, is_alone);
        if let Some((test, operands)) = condition.direct_test() {
            for operand in operands.into_iter().filter(|operand| !operand.is_none()) {
                self.use_register(operand);
            }
            return finish(self, test);
        }
        finish(self, Test::Flags(condition.flags));
        self.finish_condition(&condition);
    }

    fn finish_boolean(&mut self, result: Value, condition: &Condition) {
        self.def(result);
        match condition.flags {
            FloatFlags::One(cc) => {
                self.given(ZERO);
                self.given(ZERO);
                self.finish(Inst::Select(Select::Csinc, Width::W32, cc.inverted()));
            }
            FloatFlags::Either(first, second) => self.finish(Inst::SetOnEither(first, second)),
        }
        self.finish_condition(condition);
    }

    /// `value` is a comparison, or the inverse of a boolean.
    pub(super) fn select_boolean(&mut self, value: Value) {
        let condition = self.as_if_used_once(value, |this| this.match_condition(value));
        if let Some((Test::BitSet(bit), [source, _])) = condition.direct_test() {
            return self.select_bit(value, source, bit);
        }
        self.finish_boolean(value, &condition);
    }

    /// For `And` and `Or` of booleans.
    pub(super) fn select_logic(&mut self, value: Value) -> bool {
        if !self.is_boolean(value, DEPTH_OF_BOOLEANS) {
            return false;
        }
        let is_inverted = false;
        let chain = self.as_if_used_once(value, |this| {
            this.match_chain(Truth { value, is_inverted }, 3)
        });
        chain
            .map(|chain| self.finish_boolean(value, &chain))
            .is_some()
    }

    /// For a boolean that only this instruction uses.
    pub(super) fn match_boolean(&mut self, value: Value) -> Option<(Condition, Cc)> {
        let inner = match self.op(value) {
            Op::Unary(Unary::Widen(_), narrow) if self.has_one_use_nearby(value) => narrow,
            _ => value,
        };
        if !matches!(self.op(inner), Op::Compare(..)) || !self.has_one_use_nearby(inner) {
            return None;
        }
        let condition = self.match_condition(inner);
        match condition.flags {
            FloatFlags::One(cc) => Some((condition, cc)),
            FloatFlags::Either(..) => None,
        }
    }
}
