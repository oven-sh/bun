//! A load that is `ALWAYS_READABLE` may count on its address being computed by what cannot move above a check.

use super::Simplifier;
use super::numbering::Reading;
use crate::ir::{AccessFlags, EffectFlags, Entity, Op, Value};
use crate::passes::readability::withdraw_promise;

const HELD: EffectFlags = EffectFlags::EXITS.union(EffectFlags::CONTROL_DEPENDENT);

#[inline]
pub(super) fn makes_promise(op: &Op) -> bool {
    matches!(op, Op::Load { access, .. } | Op::LoadLane { access, .. }
        if access.has(AccessFlags::ALWAYS_READABLE))
}

impl Simplifier<'_> {
    /// Before the value is computed in another way.
    #[inline]
    pub(super) fn set_free(&mut self, value: Value) {
        if self.has_promises && self.function.effects(value).has(HELD) {
            (self.tables.values[value].is_set_free, self.has_set_free) = (true, true);
        }
    }

    /// What a load that can move is certain to find may have been stored under a condition.
    pub(super) fn set_free_if_stored(&mut self, load: Value, reading: Reading, found: Value) {
        let is_loaded_alike = matches!(self.op(found), Op::Load { address, offset, .. }
            if (address, offset) == (reading.address, reading.offset));
        if self.has_promises && !is_loaded_alike {
            (self.tables.values[load].is_set_free, self.has_set_free) = (true, true);
        }
    }

    fn is_set_free(&self, mut value: Value) -> bool {
        while !self.tables.values[value].is_set_free {
            let Op::Alias(replacement) = self.op(value) else {
                return false;
            };
            value = replacement;
        }
        true
    }

    /// Before the uses of `user` are resolved.
    pub(super) fn follow_what_is_set_free(&mut self, user: Value) {
        let mut operands = self.function.operands(user).iter();
        if operands.any(|&operand| self.is_set_free(operand)) {
            withdraw_promise(self.function, user);
            let effects = self.function.effects(user);
            self.tables.values[user].is_set_free = !effects.has(HELD) && !effects.must_execute();
            self.withdraws_all_promises |= effects.has(EffectFlags::WRITES_VARIABLE);
        }
        if user != self.function.last(self.block) {
            return;
        }
        for edge in self.function.successors(self.block) {
            let target = self.function.target(edge);
            for position in 0..self.function.args(edge).len() {
                if self.is_set_free(self.function.args(edge)[position]) {
                    let param = self.function.params(target)[position];
                    self.tables.values[param].is_set_free = true;
                    self.withdraws_all_promises |=
                        self.cfg.position(target) <= self.cfg.position(self.block);
                }
            }
        }
    }

    pub(super) fn keep_promises(&mut self) {
        if self.withdraws_all_promises {
            self.hit();
            for value in (0..self.function.value_count()).map(Value::from_index) {
                if makes_promise(self.function.op(value)) {
                    withdraw_promise(self.function, value);
                }
            }
        }
    }
}
