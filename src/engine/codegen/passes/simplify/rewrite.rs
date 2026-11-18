//! What rules look at operands with, what they answer, and how that is carried out.

use bun_engine_asm::{Cond, FloatCond, Sign};

use super::numbering::is_expression;
use super::{Simplifier, ValueInfo};
use crate::ir::{Binary, Edge, Exit, Op, State, Type, Unary, Value};

pub(super) enum Step {
    Keep,
    Is(Value),
    To(Op),
    /// For an instruction without a value.
    Gone,
    /// The instruction never lets control pass.
    Exits(Exit),
}

/// Answers. In builds with assertions they record where they are given.
impl Simplifier<'_> {
    #[cfg_attr(debug_assertions, track_caller)]
    #[inline]
    pub(super) fn hit(&mut self) {
        #[cfg(debug_assertions)]
        if let Some(fired_rules) = &mut self.tables.fired_rules {
            fired_rules.push(core::panic::Location::caller());
        }
    }

    #[cfg_attr(debug_assertions, track_caller)]
    #[inline]
    pub(super) fn is(&mut self, value: Value) -> Step {
        self.hit();
        Step::Is(value)
    }

    #[cfg_attr(debug_assertions, track_caller)]
    pub(super) fn is_int(&mut self, ty: Type, value: i64) -> Step {
        self.is_bits(ty, value as u64)
    }

    #[cfg_attr(debug_assertions, track_caller)]
    pub(super) fn is_bits(&mut self, ty: Type, bits: u64) -> Step {
        let constant = self.constant(ty, bits);
        self.is(constant)
    }

    #[cfg_attr(debug_assertions, track_caller)]
    pub(super) fn is_bool(&mut self, holds: bool) -> Step {
        self.is_bits(Type::I32, holds.into())
    }

    #[cfg_attr(debug_assertions, track_caller)]
    pub(super) fn is_vector(&mut self, bits: u128) -> Step {
        let constant = self.vector_constant(bits);
        self.is(constant)
    }

    #[cfg_attr(debug_assertions, track_caller)]
    #[inline]
    pub(super) fn to(&mut self, op: Op) -> Step {
        self.hit();
        Step::To(op)
    }

    #[cfg_attr(debug_assertions, track_caller)]
    pub(super) fn to_unary(&mut self, op: Unary, a: Value) -> Step {
        self.to(Op::Unary(op, a))
    }

    #[cfg_attr(debug_assertions, track_caller)]
    pub(super) fn to_binary(&mut self, op: Binary, a: Value, b: Value) -> Step {
        self.to(Op::Binary(op, [a, b]))
    }

    #[cfg_attr(debug_assertions, track_caller)]
    pub(super) fn to_binary_int(&mut self, op: Binary, a: Value, b: i64) -> Step {
        let b = self.right_operand(op, a, b);
        self.to_binary(op, a, b)
    }

    #[cfg_attr(debug_assertions, track_caller)]
    pub(super) fn to_compare(&mut self, cond: Cond, a: Value, b: Value) -> Step {
        self.to(Op::Compare(cond, [a, b]))
    }

    #[cfg_attr(debug_assertions, track_caller)]
    pub(super) fn to_compare_int(&mut self, cond: Cond, a: Value, b: i64) -> Step {
        let b = self.int_like(a, b);
        self.to_compare(cond, a, b)
    }

    #[cfg_attr(debug_assertions, track_caller)]
    pub(super) fn to_float_compare(&mut self, cond: FloatCond, a: Value, b: Value) -> Step {
        self.to(Op::FloatCompare(cond, [a, b]))
    }

    #[cfg_attr(debug_assertions, track_caller)]
    pub(super) fn to_select(&mut self, condition: Value, then: Value, or: Value) -> Step {
        self.to(Op::Select([condition, then, or]))
    }
}

/// Patterns.
impl Simplifier<'_> {
    #[inline]
    pub(super) fn op(&self, value: Value) -> Op {
        *self.function.op(value)
    }

    #[inline]
    pub(super) fn type_of(&self, value: Value) -> Type {
        self.function.type_of(value)
    }

    #[inline]
    pub(super) fn int(&self, value: Value) -> Option<i64> {
        self.function.int_constant(value)
    }

    #[inline]
    pub(super) fn bits(&self, value: Value) -> Option<u64> {
        self.function.constant_bits(value)
    }

    #[inline]
    pub(super) fn is_constant(&self, value: Value) -> bool {
        self.function.op(value).is_constant()
    }

    /// Nothing else uses the value, so it goes if the instruction at hand lets go of it.
    #[inline]
    pub(super) fn once(&self, value: Value) -> bool {
        self.tables.values[value].uses <= 1
    }

    #[inline]
    pub(super) fn as_unary(&self, wanted: Unary, value: Value) -> Option<Value> {
        match *self.function.op(value) {
            Op::Unary(op, a) if op == wanted => Some(a),
            _ => None,
        }
    }

    #[inline]
    pub(super) fn as_binary(&self, wanted: Binary, value: Value) -> Option<[Value; 2]> {
        match *self.function.op(value) {
            Op::Binary(op, args) if op == wanted => Some(args),
            _ => None,
        }
    }

    /// With a constant on the right.
    #[inline]
    pub(super) fn as_binary_int(&self, wanted: Binary, value: Value) -> Option<(Value, i64)> {
        let [a, b] = self.as_binary(wanted, value)?;
        Some((a, self.int(b)?))
    }

    /// By a constant, which is taken modulo the width.
    #[inline]
    pub(super) fn as_shift(&self, wanted: Binary, value: Value) -> Option<(Value, u32)> {
        let (a, amount) = self.as_binary_int(wanted, value)?;
        Some((a, amount as u32 % u32::from(self.type_of(a).width().bits())))
    }

    #[inline]
    pub(super) fn as_not(&self, value: Value) -> Option<Value> {
        match self.as_binary_int(Binary::Xor, value)? {
            (a, -1) => Some(a),
            _ => None,
        }
    }

    #[inline]
    pub(super) fn as_widen(&self, value: Value) -> Option<(Sign, Value)> {
        match *self.function.op(value) {
            Op::Unary(Unary::Widen(sign), a) => Some((sign, a)),
            _ => None,
        }
    }

    /// Using `operand` here instead of `value`, which is computed from it and stays in use, would take another
    /// register: from a distant block to here, or in each turn of a loop in which the one becomes the other.
    #[inline]
    pub(super) fn takes_place_of(&self, value: Value, operand: Value) -> bool {
        if self.once(value) {
            return false;
        }
        if self.once(operand) && self.function.block_of(value) != self.block {
            return true;
        }
        let Op::Param(position) = self.op(operand) else {
            return false;
        };
        let is_passed = |&edge: &Edge| {
            self.function.is_attached(edge)
                && self
                    .function
                    .resolve(self.function.args(edge)[position as usize])
                    == value
        };
        let header = self.function.block_of(operand);
        self.cfg.predecessors(header).last().is_some_and(is_passed)
    }

    /// The value is computed outside the loop that the block is in.
    pub(super) fn is_from_outside_loop(&self, value: Value) -> bool {
        let home = self.function.block_of(value).expand();
        home.map_or(0, |home| self.cfg.depth(home)) < self.cfg.depth(self.block)
    }
}

/// The operand that two commutative operations share, and the others.
#[inline]
pub(super) fn shared_operand([a, b]: [Value; 2], [c, d]: [Value; 2]) -> Option<[Value; 3]> {
    if a == c {
        Some([a, b, d])
    } else if a == d {
        Some([a, b, c])
    } else if b == c {
        Some([b, a, d])
    } else {
        (b == d).then_some([b, a, c])
    }
}

/// New values.
impl Simplifier<'_> {
    #[inline]
    fn track(&mut self, value: Value) -> Value {
        let count = self.function.value_count();
        self.tables.values.grow_to(count, ValueInfo::default());
        value
    }

    pub(super) fn constant(&mut self, ty: Type, bits: u64) -> Value {
        let constant = self.function.constant(ty, bits);
        self.track(constant)
    }

    pub(super) fn int_like(&mut self, value: Value, constant: i64) -> Value {
        self.constant(self.type_of(value), constant as u64)
    }

    pub(super) fn vector_constant(&mut self, bits: u128) -> Value {
        let constant = self.function.const_v128(bits);
        self.track(constant)
    }

    fn right_operand(&mut self, op: Binary, left: Value, constant: i64) -> Value {
        let ty = if op.is_shift() {
            Type::I32
        } else {
            self.type_of(left)
        };
        self.constant(ty, constant as u64)
    }

    /// Constants go to the right, and otherwise the older value to the left. Returns whether they changed places.
    #[inline(always)]
    pub(super) fn put_in_order(&mut self, args: &mut [Value; 2]) -> bool {
        let [a, b] = *args;
        let is_reversed = !self.is_constant(b) && (a > b || self.is_constant(a));
        if is_reversed {
            *args = [b, a];
            self.has_touched_operands = true;
        }
        is_reversed
    }

    /// A value for an operation without effects.
    pub(super) fn make(&mut self, mut op: Op, ty: Type) -> Value {
        loop {
            match self.step(&mut op, ty) {
                Step::Is(value) => return value,
                Step::To(new) => op = new,
                _ => return self.make_as_it_is(op, ty),
            }
        }
    }

    pub(super) fn make_as_it_is(&mut self, op: Op, ty: Type) -> Value {
        match self.find_expression(&op, ty) {
            Ok(known) => known,
            Err(vacancy) => {
                let value = self.insert_before(self.cursor, op, ty);
                self.tables.numbering.add(&vacancy, value);
                value
            }
        }
    }

    /// It goes again unless something comes to use it.
    pub(super) fn insert_before(&mut self, next: Value, op: Op, ty: Type) -> Value {
        let origin = self.function.origin(next);
        let value = self.function.insert_before(next, op, ty, origin);
        self.track(value);
        self.retain_all(op.inline_operands());
        self.tables.doomed.push(value);
        value
    }

    pub(super) fn make_unary(&mut self, op: Unary, to: Type, a: Value) -> Value {
        self.make(Op::Unary(op, a), to)
    }

    pub(super) fn make_binary(&mut self, op: Binary, a: Value, b: Value) -> Value {
        self.make(Op::Binary(op, [a, b]), self.type_of(a))
    }

    pub(super) fn make_binary_int(&mut self, op: Binary, a: Value, b: i64) -> Value {
        let b = self.right_operand(op, a, b);
        self.make_binary(op, a, b)
    }

    pub(super) fn make_compare(&mut self, cond: Cond, a: Value, b: Value) -> Value {
        self.make(Op::Compare(cond, [a, b]), Type::I32)
    }

    pub(super) fn make_compare_int(&mut self, cond: Cond, a: Value, b: i64) -> Value {
        let b = self.int_like(a, b);
        self.make_compare(cond, a, b)
    }

    pub(super) fn make_wrap(&mut self, a: Value) -> Value {
        self.make_unary(Unary::Wrap, Type::I32, a)
    }

    pub(super) fn make_widen(&mut self, sign: Sign, a: Value) -> Value {
        self.make_unary(Unary::Widen(sign), Type::I64, a)
    }

    /// From an I32 that is not negative.
    pub(super) fn make_of_type(&mut self, ty: Type, a: Value) -> Value {
        if ty == Type::I64 {
            self.make_widen(Sign::Unsigned, a)
        } else {
            a
        }
    }
}

/// Counting uses.
impl Simplifier<'_> {
    #[inline]
    pub(super) fn retain_all(&mut self, values: &[Value]) {
        for &value in values {
            self.tables.values[value].uses += 1;
        }
    }

    #[inline]
    pub(super) fn release(&mut self, value: Value) {
        let value = self.function.resolve(value);
        let uses = &mut self.tables.values[value].uses;
        *uses -= 1;
        if *uses == 0 {
            self.tables.doomed.push(value);
        }
    }

    fn release_state(&mut self, state: State) {
        if state.is_none() {
            return;
        }
        self.tables.state_users[state] -= 1;
        if self.tables.state_users[state] == 0 {
            for position in 0..self.function.state(state).len() {
                self.release(self.function.state(state)[position]);
            }
        }
    }

    pub(super) fn release_uses_by(&mut self, user: Value) {
        for position in 0..self.function.operands(user).len() {
            self.release(self.function.operands(user)[position]);
        }
        self.release_state(self.function.state_of(user));
    }

    /// Not while a rule holds on to values.
    #[inline]
    pub(super) fn remove_unused(&mut self) {
        if !self.tables.doomed.is_empty() {
            self.remove_doomed();
        }
    }

    fn remove_doomed(&mut self) {
        while let Some(value) = self.tables.doomed.pop() {
            let op = self.function.op(value);
            let is_instruction =
                !op.is_floating() && !matches!(op, Op::Param(_) | Op::Alias(_) | Op::Removed);
            if is_instruction
                && self.tables.values[value].uses == 0
                && !self.function.effects(value).must_execute()
            {
                self.release_uses_by(value);
                self.function.remove(value);
            }
        }
    }

    pub(super) fn pass_uses_on(&mut self, from: Value, to: Value) {
        let uses = core::mem::take(&mut self.tables.values[from].uses);
        self.tables.values[to].uses += uses;
        if self.tables.values[from].is_in_state {
            (
                self.tables.values[to].is_in_state,
                self.left_aliases_in_states,
            ) = (true, true);
        }
        if uses == 0 {
            self.tables.doomed.push(to);
        }
    }

    pub(super) fn replace(&mut self, value: Value, replacement: Value) {
        self.set_free(value);
        self.pass_uses_on(value, replacement);
        self.release_uses_by(value);
        self.function.replace(value, replacement);
        self.remove_unused();
    }

    /// `new` has the state of the old operation, or none.
    pub(super) fn change(&mut self, value: Value, new: Op) {
        if is_expression(&new) {
            self.set_free(value);
        }
        self.retain_all(new.inline_operands());
        let old = core::mem::replace(self.function.op_mut(value), new);
        for &operand in old.inline_operands() {
            self.release(operand);
        }
        if let (Some(exit), None) = (old.exit(), new.exit()) {
            self.release_state(exit.state);
        }
        self.remove_unused();
    }

    pub(super) fn discard(&mut self, value: Value) {
        self.release_uses_by(value);
        self.function.remove(value);
        self.remove_unused();
    }
}
