//! Control flow in small blocks, as the passes that copy, thread and fold look for it.

use bun_engine_asm::{Cond, FloatCond};
use bun_engine_codegen::ir::{
    Binary, Block, Checked, Op, State, Successor, Type, Unary, Value, Wide,
};

use super::super::integers::width;
use super::super::{Class, Generator};
use super::Way;

/// Inside a loop that `count` has opened.
pub(in super::super) struct Counting {
    pub(in super::super) counter: Value,
    pub(in super::super) first: Value,
    pub(in super::super) limit: Value,
    /// The other parameters of the header.
    pub(in super::super) carried: Vec<Value>,
}

impl Generator<'_> {
    pub(super) fn shape_statement(&mut self, budget: u32) {
        match self.random.below(20) {
            0 | 1 => self.chain_of_truths(),
            2 => self.switch_on_param(),
            3 | 4 => self.related_branches(),
            5 => self.chain_of_equalities(),
            6 => self.tested_selection(),
            7 | 8 if self.trips * 8 <= self.shape.trips => self.tested_counter(budget),
            9 => self.use_in_one_arm(),
            10 => self.empty_diamond(),
            11 if self.trips * 8 <= self.shape.trips => self.unruly_counter(),
            12 if self.trips * 8 <= self.shape.trips => self.checks_at_top(1),
            13 if self.trips * 8 <= self.shape.trips => self.speculating_loop(),
            _ if self.shape.weights.accesses != 0 => self.memory_shape(budget),
            _ => self.related_branches(),
        }
    }

    fn block_with(&mut self, types: &[Type]) -> (Block, Vec<Value>) {
        let block = self.function.new_block();
        let params = types.iter().map(|&ty| self.function.add_param(block, ty));
        (block, params.collect())
    }

    fn way(&mut self, target: Block, args: &[Value]) -> Way {
        Way {
            target,
            args: args.to_vec(),
            classes: Vec::new(),
            is_rare: self.random.one_in(6),
        }
    }

    /// Mostly nothing.
    pub(in super::super) fn trifle(&mut self) {
        let (nesting, depth) = (self.nesting, self.depth);
        (self.nesting, self.depth) = (self.shape.nesting, self.shape.expression_depth - 1);
        let count = self.random.pick(&[0, 0, 0, 1, 1, 2]);
        self.body(count);
        (self.nesting, self.depth) = (nesting, depth);
    }

    /// The arms give values of these types, the first if the condition is not zero.
    pub(in super::super) fn choose(
        &mut self,
        condition: Value,
        types: &[Type],
        arm: &mut dyn FnMut(&mut Self, bool) -> Vec<Value>,
    ) -> Vec<Value> {
        let (join, params) = self.block_with(types);
        let ways = [self.plain_way(), self.plain_way()];
        let blocks = [ways[0].target, ways[1].target];
        self.branch_either_way(condition, ways);
        for (block, holds) in blocks.into_iter().zip([true, false]) {
            let mark = self.mark();
            self.block = block;
            let args = arm(self, holds);
            self.builder().jump(join, &args);
            self.restore(mark);
        }
        self.block = join;
        params
    }

    /// Like `choose`, with no block for the other way.
    pub(in super::super) fn perhaps(
        &mut self,
        condition: Value,
        otherwise: &[Value],
        arm: &mut dyn FnMut(&mut Self) -> Vec<Value>,
    ) -> Vec<Value> {
        let types: Vec<Type> = otherwise.iter().map(|&value| self.type_of(value)).collect();
        let (join, params) = self.block_with(&types);
        let ways = [self.plain_way(), self.way(join, otherwise)];
        let (block, mark) = (ways[0].target, self.mark());
        self.branch_either_way(condition, ways);
        self.block = block;
        let args = arm(self);
        self.builder().jump(join, &args);
        self.restore(mark);
        self.block = join;
        params
    }

    pub(in super::super) fn keep_all(&mut self, values: &[Value]) {
        for &value in values {
            self.keep(value, Class::Data(self.type_of(value)));
        }
    }

    /// A value that tells the arms apart.
    pub(in super::super) fn witness(&mut self, condition: Value) -> Value {
        let seen = self.choose(condition, &[Type::I64], &mut |this, holds| {
            this.trifle();
            let any = this.known_int(Type::I64);
            vec![this.binary_constant(Binary::Add, any, 17 + i64::from(holds))]
        });
        self.keep_all(&seen);
        seen[0]
    }

    fn truth(&mut self, ty: Type) -> Value {
        if ty == Type::I32 && self.random.flip() {
            self.boolean()
        } else {
            let number = self.random.pick(&[0, 0, 1, 1, 2, -1]);
            self.constant(ty, number)
        }
    }

    fn chain_of_truths(&mut self) {
        let (mut condition, mut tuples) = (self.condition(), Vec::new());
        for _ in 0..self.random.between(1, 9) {
            let (ty, other) = (self.int_type(), self.int_type());
            let mut arm = |this: &mut Self| {
                this.trifle();
                vec![this.truth(ty), this.int(other)]
            };
            let params = if self.random.flip() {
                self.choose(condition, &[ty, other], &mut |this, _| arm(this))
            } else {
                let otherwise = [self.truth(ty), self.int(other)];
                self.perhaps(condition, &otherwise, &mut arm)
            };
            let params = if self.random.one_in(5) {
                let (next, passed) = self.block_with(&[ty, other]);
                let inverse = self.binary_constant(Binary::Xor, params[0], 1);
                self.builder().jump(next, &[inverse, params[1]]);
                self.block = next;
                passed
            } else {
                params
            };
            self.keep_all(&params);
            if self.random.one_in(3) {
                self.trifle();
            }
            if self.random.one_in(10) {
                let word = self.convert_int(params[1], Type::I64);
                let op = Op::Wide(Wide::Add, [word; 4]);
                tuples.push(self.emit(op, Type::Tuple));
            }
            condition = match self.random.below(6) {
                0 => self.compare_constant(Cond::Eq, params[0], 0),
                1 => self.binary_constant(Binary::And, params[0], 1),
                2 => {
                    let cond = self.random.pick(&Cond::ALL);
                    self.compare_constant(cond, params[0], 1)
                }
                _ => params[0],
            };
            if self.random.one_in(8) {
                let fails = self.compare_constant(Cond::Eq, params[0], 2);
                self.check(fails);
            }
        }
        self.witness(condition);
        for tuple in tuples {
            let high = self.builder().extract(tuple, 1);
            self.keep_all(&[high]);
        }
    }

    fn switch_on_param(&mut self) {
        let condition = self.condition();
        let class = Class::Index {
            ty: Type::I32,
            below: 4,
            is_guarded: true,
        };
        let state = self.choose(condition, &[Type::I32], &mut |this, _| {
            this.trifle();
            if this.random.one_in(4) {
                vec![this.value_of(class)]
            } else {
                vec![this.function.const32(this.random.below(4) as i32)]
            }
        })[0];
        self.keep(state, class);
        let (join, seen) = self.block_with(&[Type::I64]);
        let arms: Vec<Way> = (0..self.random.between(2, 4))
            .map(|_| self.plain_way())
            .collect();
        let successors: Vec<Successor<'_>> = arms.iter().map(Way::successor).collect();
        if self.random.flip() {
            let table: Vec<u32> = (0..4)
                .map(|_| self.random.below(arms.len()) as u32)
                .collect();
            self.builder().jump_table(state, table, &successors);
        } else {
            let cases: Vec<_> = (1..).zip(successors[1..].iter().copied()).collect();
            self.builder().switch(state, &cases, successors[0]);
        }
        self.fill_arms(&arms, join);
        self.keep_all(&seen);
    }

    /// `join` takes an I64.
    fn fill_arms(&mut self, arms: &[Way], join: Block) {
        for (number, arm) in (100..).zip(arms) {
            let mark = self.mark();
            self.block = arm.target;
            self.trifle();
            let any = self.known_int(Type::I64);
            let seen = self.binary_constant(Binary::Xor, any, number);
            self.builder().jump(join, &[seen]);
            self.restore(mark);
        }
        self.block = join;
    }

    /// Compares one of the values, or something close to it, with another or with a constant.
    fn related_condition(&mut self, values: &[Value], near: i64) -> Value {
        let (a, b) = (self.random.pick(values), self.random.pick(values));
        let ty = self.type_of(a);
        if ty.is_float() {
            let cond = self.random.pick(&FloatCond::ALL);
            return self.float_compare(cond, a, b);
        }
        let cond = self.random.pick(&Cond::ALL);
        let close = near.wrapping_add(self.random.between(-3, 3));
        match self.random.below(10) {
            0..4 => self.compare(cond, a, b),
            4 => {
                let by = self.random.between(-4, 4);
                let moved = self.binary_constant(Binary::Add, a, by);
                self.compare_constant(cond, moved, close)
            }
            5 => {
                let (first, second) = (
                    self.related_condition(values, near),
                    self.related_condition(values, near),
                );
                let op = self.random.pick(&[Binary::And, Binary::Or]);
                self.binary(op, first, second)
            }
            6 => {
                let edge = self.random.pick(&[0, -1, 1, i64::MIN, i64::MAX]) >> (64 - width(ty));
                self.compare_constant(cond, a, edge)
            }
            _ => self.compare_constant(cond, a, close),
        }
    }

    fn related_branches(&mut self) {
        let has_floats = self.shape.weights.floats != 0 && self.random.one_in(6);
        let ty = if has_floats {
            self.float_type()
        } else {
            self.int_type()
        };
        let near = self.random.pick(&[0, 0, 4, 10, -3]);
        let values = [(); 3].map(|()| match self.random.below(5) {
            _ if has_floats => self.float(ty).0,
            2 => {
                let edge = self.random.pick(&[-1, i64::MIN, i64::MAX]) >> (64 - width(ty));
                let edge = self.constant(ty, edge);
                self.unary(Unary::Opaque, ty, edge)
            }
            3 => self.fitting(ty),
            0 => {
                let any = self.known_int(ty);
                self.binary_constant(Binary::And, any, 15)
            }
            1 => {
                let any = self.known_int(ty);
                let small = self.binary_constant(Binary::Sar, any, width(ty) - 4);
                self.binary_constant(Binary::Add, small, near)
            }
            _ => self.known_int(ty),
        });
        let values = &values[..self.random.between(1, 3) as usize];
        let depth = self.random.between(1, 4);
        let seen = self.test_again(values, near, depth);
        self.keep_all(&[seen]);
    }

    /// Mostly only the promise tells how large it can be.
    fn fitting(&mut self, ty: Type) -> Value {
        let count = self.random.pick(&[1, 3, 8, 29, 31, width(ty) - 1]);
        let any = self.known_int(ty);
        let mut masked = self.binary_constant(Binary::And, any, i64::MAX >> (63 - count));
        if self.random.percent(80) {
            masked = self.unary(Unary::Opaque, ty, masked);
        }
        self.unary(Unary::FitsIn(count as u8), ty, masked)
    }

    fn test_again(&mut self, values: &[Value], near: i64, depth: i64) -> Value {
        let condition = self.related_condition(values, near);
        let ty = self.type_of(values[0]);
        if depth == 0 {
            let (a, b) = (self.random.pick(values), self.random.pick(values));
            return match self.random.below(6) {
                0 if ty.is_int() => {
                    let op = self
                        .random
                        .pick(&[Checked::Add, Checked::Sub, Checked::Mul]);
                    let result = self.checked(op, a, b);
                    self.convert_int(result, Type::I64)
                }
                1 if ty.is_int() => {
                    let op = self.random.pick(&[Binary::TotalDiv, Binary::TotalRem]);
                    let result = self.binary(op, a, b);
                    self.convert_int(result, Type::I64)
                }
                2 if ty.is_int() => {
                    let chosen = self.select(condition, a, b);
                    self.convert_int(chosen, Type::I64)
                }
                3 => self.witness(condition),
                _ => self.convert_int(condition, Type::I64),
            };
        }
        match self.random.below(8) {
            0 => {
                let (first, again) = (self.witness(condition), self.witness(condition));
                let rest = self.test_again(values, near, depth - 1);
                let both = self.binary(Binary::Sub, first, again);
                self.binary(Binary::Xor, both, rest)
            }
            1 => {
                let unlikely = self.related_condition(values, near);
                let fails = self.binary(Binary::And, condition, unlikely);
                self.check(fails);
                self.test_again(values, near, depth - 1)
            }
            2 => {
                let first = self.witness(condition);
                let rest = self.test_again(values, near, depth - 1);
                self.binary(Binary::Add, first, rest)
            }
            _ => self.choose(condition, &[Type::I64], &mut |this, _| {
                vec![this.test_again(values, near, depth - 1)]
            })[0],
        }
    }

    fn chain_of_equalities(&mut self) {
        let ty = self.int_type();
        let any = self.known_int(ty);
        let (mask, base) = (self.random.pick(&[3, 7, 15]), self.random.between(-4, 2));
        let low = self.binary_constant(Binary::And, any, mask);
        let subject = self.binary_constant(Binary::Add, low, base);
        let (join, seen) = self.block_with(&[Type::I64]);
        let (direct, mark) = (self.known_int(Type::I64), self.mark());
        let mut arms = Vec::new();
        let mut shortcut = self.random.one_in(5).then(|| {
            let condition = self.condition();
            let ways = [self.plain_way(), self.plain_way()];
            let [start, middle] = [ways[0].target, ways[1].target];
            self.branch(condition, ways);
            self.block = start;
            (middle, self.mark())
        });
        for turn in (0..self.random.between(2, 12)).rev() {
            let key = base + self.random.between(0, mask + 1);
            let mut matching = |this: &mut Self| {
                if this.random.one_in(4) {
                    return this.way(join, &[direct]);
                }
                let way = this.plain_way();
                arms.push((this.way(way.target, &[]), this.scope.clone(), this.sum));
                way
            };
            let joined = shortcut.take_if(|_| turn == 0 || self.random.one_in(3));
            let rest = match joined {
                Some((middle, _)) => self.way(middle, &[]),
                None => self.plain_way(),
            };
            let next = rest.target;
            match self.random.below(10) {
                0 => {
                    let way = matching(self);
                    self.branch(subject, [rest, way]);
                }
                1 => {
                    let ways = [matching(self), matching(self)];
                    let cases = [(key, ways[0].successor()), (key + 2, ways[1].successor())];
                    self.builder().switch(subject, &cases, rest.successor());
                }
                kind => {
                    let cond = if kind < 4 { Cond::Ne } else { Cond::Eq };
                    let key = self.constant(ty, key);
                    let holds = self.builder().compare(cond, subject, key);
                    self.learn(holds, Class::BOOLEAN);
                    let way = matching(self);
                    let ways = if kind < 4 { [rest, way] } else { [way, rest] };
                    self.branch(holds, ways);
                }
            }
            self.block = next;
            if let Some((_, before)) = joined {
                self.restore(before);
            }
            if self.random.one_in(10) {
                self.trifle();
            }
        }
        arms.push((self.way(self.block, &[]), self.scope.clone(), self.sum));
        for (arm, scope, sum) in arms {
            (self.scope, self.sum) = (scope, sum);
            self.fill_arms(&[arm], join);
        }
        self.restore(mark);
        self.keep_all(&seen);
    }

    fn tested_selection(&mut self) {
        let (ty, condition) = (self.int_type(), self.condition());
        let (constant, other) = (self.truth(ty), self.int(ty));
        let chosen = if self.random.flip() {
            self.select(condition, constant, other)
        } else {
            self.select(condition, other, constant)
        };
        self.keep(chosen, Class::Data(ty));
        let mut tested = chosen;
        for _ in 0..self.random.below(3) {
            let op = self
                .random
                .pick(&[Binary::Add, Binary::And, Binary::Xor, Binary::Shr]);
            let by = self.random.between(0, 5);
            tested = self.binary_constant(op, tested, by);
            self.keep(tested, Class::Data(ty));
            if self.random.one_in(4) {
                self.trifle();
            }
        }
        if self.random.flip() {
            let number = self.random.between(0, 9);
            let fails = self.compare_constant(Cond::Eq, tested, number);
            self.check(fails);
        } else {
            self.witness(tested);
        }
    }

    /// At most seven turns, near the ends of the range of the type as often as not. The body gives the next values of
    /// those that start as `initial`, and the result is their last.
    pub(in super::super) fn count(
        &mut self,
        initial: &[Value],
        body: &mut dyn FnMut(&mut Self, &Counting) -> Vec<Value>,
    ) -> Vec<Value> {
        let ty = self.int_type();
        let greatest = i64::MAX >> (64 - width(ty));
        let (is_up, tests_first) = (self.random.percent(65), self.random.flip());
        let step = self.random.pick(&[1, 1, 1, 2, 3]);
        let cond = match (step == 1 && self.random.one_in(3), is_up) {
            (true, _) => Cond::Ne,
            (_, true) => {
                self.random
                    .pick(&[Cond::Lt, Cond::Lt, Cond::Below, Cond::Le, Cond::BelowEq])
            }
            (_, false) => self
                .random
                .pick(&[Cond::Gt, Cond::Ge, Cond::Above, Cond::AboveEq]),
        };
        // From there, 12 steps of one in the direction of counting cross the point at which the order wraps.
        let seam = if cond.is_signed() { greatest } else { -1 };
        let clear = if is_up {
            seam - 12
        } else {
            seam.wrapping_add(13)
        };
        let number = match self.random.below(6) {
            0 | 1 => clear,
            2 if cond == Cond::Ne => self.random.pick(&[greatest - 3, -3, !greatest + 3, 3]),
            3 if is_up != cond.is_signed() => 20,
            3 => -20,
            _ if is_up => 0,
            _ => 20,
        };
        let direction = if is_up { 1 } else { -1 };
        let small = |this: &mut Self, below| {
            this.value_of(Class::Index {
                ty,
                below,
                is_guarded: true,
            })
        };
        let along = |this: &mut Self, from, by| {
            let op = if is_up { Binary::Add } else { Binary::Sub };
            this.binary(op, from, by)
        };
        let base = self.constant(ty, number);
        let first = if self.random.flip() {
            base
        } else {
            let offset = small(self, 3);
            along(self, base, offset)
        };
        let turns = small(self, 7);
        let turns = if cond == Cond::Ne && !tests_first {
            self.binary_constant(Binary::Or, turns, 1)
        } else {
            turns
        };
        let from = if cond == Cond::Ne { first } else { base };
        let mut limit = along(self, from, turns);
        if self.random.flip() {
            limit = self.unary(Unary::Opaque, ty, limit);
            if matches!(number, 0 | 20) {
                let count = self.random.pick(&[5, 29, 31]);
                limit = self.unary(Unary::FitsIn(count), ty, limit);
            }
        }

        let types: Vec<Type> = initial.iter().map(|&value| self.type_of(value)).collect();
        let (header, mut carried) = self.block_with(&[&types[..], &[ty]].concat());
        let (exit, results) = self.block_with(&types);
        let counter = carried.pop().unwrap();
        let args = [initial, &[first]].concat();
        let may_be_skipped = !tests_first && self.random.flip();
        if may_be_skipped {
            let enters = self.compare(cond, first, limit);
            let ways = [self.way(header, &args), self.way(exit, initial)];
            self.branch_either_way(enters, ways);
        } else {
            self.builder().jump(header, &args);
        }
        let (mark, outer_trips) = (self.mark(), self.trips);
        self.trips *= 8;
        self.block = header;
        self.keep_all(&carried);
        self.learn(counter, Class::Data(ty));
        let tuple = self.random.one_in(8).then(|| {
            let word = self.convert_int(counter, Type::I64);
            self.emit(Op::Wide(Wide::Add, [word; 4]), Type::Tuple)
        });
        if tests_first {
            self.trifle();
            let goes_on = self.compare(cond, counter, limit);
            let ways = [self.plain_way(), self.way(exit, &carried)];
            let inside = ways[0].target;
            self.branch_either_way(goes_on, ways);
            self.block = inside;
        }
        let counting = Counting {
            counter,
            first,
            limit,
            carried,
        };
        let mut next = body(self, &counting);
        let advanced = if self.random.one_in(4) && cond.is_signed() {
            let step = self.constant(ty, direction * step);
            self.checked(Checked::Add, counter, step)
        } else {
            self.binary_constant(Binary::Add, counter, direction * step)
        };
        if tests_first {
            next.push(advanced);
            self.builder().jump(header, &next);
        } else {
            let goes_on = self.compare(cond, advanced, limit);
            let leaving = self.way(exit, &next);
            next.push(advanced);
            let ways = [self.way(header, &next), leaving];
            self.branch_either_way(goes_on, ways);
        }
        self.restore(mark);
        self.trips = outer_trips;
        self.block = exit;
        if let Some(tuple) = tuple.filter(|_| !may_be_skipped) {
            let low = self.builder().extract(tuple, 0);
            self.keep_all(&[low]);
        }
        results
    }

    fn tested_counter(&mut self, budget: u32) {
        let initial = [self.known_int(Type::I64)];
        let results = self.count(&initial, &mut |this, counting| {
            let values = [counting.counter, counting.first, counting.limit];
            let mut sum = this.binary_constant(Binary::Mul, counting.carried[0], 3);
            for _ in 0..this.random.between(1, 3) {
                let depth = this.random.between(0, 1);
                let seen = this.test_again(&values, 0, depth);
                sum = this.binary(Binary::Add, sum, seen);
            }
            this.body(budget);
            vec![sum]
        });
        self.keep_all(&results);
    }

    /// Any start, step and test. Fuel brings it to an end.
    fn unruly_counter(&mut self) {
        let ty = self.int_type();
        let greatest = i64::MAX >> (64 - width(ty));
        let near = self.random.pick(&[0, greatest, !greatest, 9]);
        let around = |this: &mut Self| {
            let number = near.wrapping_add(this.random.between(-5, 5));
            let constant = this.constant(ty, number);
            if this.random.flip() {
                constant
            } else {
                let opaque = this.unary(Unary::Opaque, ty, constant);
                let mask = this.random.pick(&[-1, -1, greatest, 15]);
                this.binary_constant(Binary::And, opaque, mask)
            }
        };
        let add = |this: &mut Self, value, by| {
            let by = this.constant(ty, by);
            if this.random.one_in(5) {
                this.checked(Checked::Add, value, by)
            } else {
                this.builder().add(value, by)
            }
        };
        let (end, fixed_limit) = (around(self), around(self));
        let first = if self.random.flip() {
            let back = self.random.between(-2, 1);
            add(self, end, back)
        } else {
            around(self)
        };
        let step = self.random.pick(&[1, 1, 1, 2, 3, -1, -1, -1, -2]);
        let any = self.random.pick(&Cond::ALL);
        let cond = self.random.pick(&[Cond::Ne, Cond::Lt, Cond::Gt, any]);
        let (header, params) = self.block_with(&[Type::I64, ty, Type::I32]);
        let (exit, results) = self.block_with(&[Type::I64]);
        let [sum, counter, fuel] = params[..] else {
            unreachable!()
        };
        let (initial, full) = (self.known_int(Type::I64), self.function.const32(7));
        if self.random.flip() {
            let enters = self.builder().compare(cond, first, fixed_limit);
            let ways = [
                self.way(header, &[initial, first, full]),
                self.way(exit, &[initial]),
            ];
            self.branch(enters, ways);
        } else {
            self.builder().jump(header, &[initial, first, full]);
        }
        let (mark, outer_trips) = (self.mark(), self.trips);
        self.trips *= 8;
        self.block = header;
        let limit = if self.random.one_in(5) {
            let fuel = self.convert_int(fuel, ty);
            self.binary(Binary::Sub, fixed_limit, fuel)
        } else {
            fixed_limit
        };
        let early = self.random.one_in(4).then(|| add(self, counter, step));
        let go_on_if = |this: &mut Self, condition| {
            let ways = [this.plain_way(), this.way(exit, &[sum])];
            let inside = ways[0].target;
            this.branch(condition, ways);
            this.block = inside;
        };
        let tests_first = self.random.flip();
        if tests_first && self.random.one_in(5) {
            let holds = self.builder().compare(cond, counter, limit);
            self.perhaps(holds, &[], &mut |_| Vec::new());
        } else if tests_first {
            let holds = self.builder().compare(cond, counter, limit);
            go_on_if(self, holds);
        }
        go_on_if(self, fuel);
        let less = self.binary_constant(Binary::Add, fuel, -1);
        let mut seen = self.test_again(&[counter, first, limit, end], near, 0);
        for other in [first, limit, end, self.constant(ty, 0)] {
            for cond in [Cond::Lt, Cond::Gt, self.random.pick(&Cond::ALL)] {
                let holds = self.compare(cond, counter, other);
                let (holds, doubled) = (
                    self.convert_int(holds, Type::I64),
                    self.binary(Binary::Add, seen, seen),
                );
                seen = self.binary(Binary::Add, doubled, holds);
            }
        }
        let stirred = self.binary_constant(Binary::Mul, sum, 5);
        let sum = self.binary(Binary::Add, stirred, seen);
        if self.random.one_in(4) {
            let other_step = self.random.pick(&[step, -step, -3 * step]);
            let (turns_back, other) = (self.condition(), add(self, counter, other_step));
            let ways = [self.way(header, &[sum, other, less]), self.plain_way()];
            let rest = ways[1].target;
            self.branch(turns_back, ways);
            self.block = rest;
        }
        let next = early.unwrap_or_else(|| add(self, counter, step));
        if tests_first {
            self.builder().jump(header, &[sum, next, less]);
        } else {
            let holds = self.builder().compare(cond, next, limit);
            let ways = [self.way(header, &[sum, next, less]), self.way(exit, &[sum])];
            self.branch(holds, ways);
        }
        self.restore(mark);
        self.trips = outer_trips;
        self.block = exit;
        self.keep_all(&results);
    }

    /// Checks of what is settled before the loop, or before the loop around it, near the top of a loop that tests last.
    fn checks_at_top(&mut self, inner_loops: u32) {
        let settled = [(); 2].map(|()| {
            let any = self.known_int(Type::I32);
            let low = self.binary_constant(Binary::And, any, 3);
            let fails = self.compare_constant(Cond::Eq, low, 3);
            self.learn(fails, Class::BOOLEAN);
            fails
        });
        let (header, params) = self.block_with(&[Type::I32]);
        let zero = self.function.const32(0);
        self.builder().jump(header, &[zero]);
        let (mark, outer_trips) = (self.mark(), self.trips);
        self.trips *= 4;
        self.block = header;
        self.keep_all(&params);
        let next = self.binary_constant(Binary::Add, params[0], 1);
        for _ in 0..self.random.between(1, 4) {
            match self.random.below(10) {
                0 => {
                    let skips = self.compare_constant(Cond::Lt, next, 2);
                    let ways = [self.way(header, &[next]), self.plain_way()];
                    let rest = ways[1].target;
                    self.branch(skips, ways);
                    self.block = rest;
                }
                1 if self.shape.weights.calls != 0 => self.call_with_handlers(0),
                2 if self.random.flip() => {
                    let next = self.function.new_block();
                    self.terminal_patchpoint(&[next.into(), next.into()], params[0]);
                    self.block = next;
                }
                2 => self.trifle(),
                3 | 4 if inner_loops != 0 => self.checks_at_top(inner_loops - 1),
                5 => {
                    let varies = self.compare_constant(Cond::Eq, params[0], 9);
                    let fails = self.binary(Binary::Or, varies, settled[0]);
                    self.learn(fails, Class::BOOLEAN);
                }
                6 | 7 => {
                    let fails = self.boolean();
                    self.check(fails);
                }
                _ => {
                    let fails = self.random.pick(&settled);
                    self.check_keeping(fails, &params);
                }
            }
        }
        let goes_on = self.compare_constant(Cond::Lt, next, 3);
        let ways = [self.way(header, &[next]), self.plain_way()];
        let exit = ways[1].target;
        self.branch(goes_on, ways);
        self.restore(mark);
        self.trips = outer_trips;
        self.block = exit;
    }

    /// The exits of a turn go back to its start, while the parameters are counted on and handed to each other.
    fn speculating_loop(&mut self) {
        let ty = self.int_type();
        let count = self.random.pick(&[1, 2, 3, 3, 5, 8, 14]);
        let mut initial: Vec<Value> = (0..count)
            .map(|_| {
                let any = self.known_int(ty);
                self.binary_constant(Binary::Sar, any, 3)
            })
            .collect();
        initial.push(self.function.const32(0));
        let types: Vec<Type> = initial.iter().map(|&value| self.type_of(value)).collect();
        let (header, params) = self.block_with(&types);
        let (exit, results) = self.block_with(&types);
        self.builder().jump(header, &initial);
        let (mark, outer_trips) = (self.mark(), self.trips);
        self.trips *= 4;
        self.block = header;
        let kept = params.iter().copied().filter(|_| self.random.percent(70));
        let state = self.function.add_state(&kept.collect::<Vec<_>>());
        for others in (0..self.random.between(1, 3)).rev() {
            let mut rest = Block::NONE;
            if others != 0 {
                let [a, b] = [(); 2].map(|()| self.random.pick(&params[..count]));
                let condition = self.compare(Cond::Lt, a, b);
                let ways = [self.plain_way(), self.plain_way()];
                let arm = ways[0].target;
                rest = ways[1].target;
                self.branch_either_way(condition, ways);
                self.block = arm;
            }
            let before = self.mark();
            let mut next = self.speculate(&params[..count], state);
            next.push(self.binary_constant(Binary::Add, params[count], 1));
            let goes_on = self.compare_constant(Cond::Lt, next[count], 4);
            let ways = [self.way(header, &next), self.way(exit, &next)];
            self.branch_either_way(goes_on, ways);
            self.restore(before);
            self.block = rest;
        }
        self.restore(mark);
        self.trips = outer_trips;
        self.block = exit;
        self.keep_all(&results);
    }

    fn speculate(&mut self, params: &[Value], mut state: State) -> Vec<Value> {
        let (mut current, count, ty) = (params.to_vec(), params.len(), self.type_of(params[0]));
        for _ in 0..self.random.between(1, 8) {
            let [to, from, other] = [(); 3].map(|()| self.random.below(count));
            match self.random.below(12) {
                0..4 => {
                    let op = self.random.pick(&[Checked::Add, Checked::Sub]);
                    let by = match self.random.between(-2, 3) {
                        0 => current[other],
                        number => self.constant(ty, number),
                    };
                    let old = current[from];
                    current[from] = self.checked_with(op, old, by, state);
                    if to != from && self.random.flip() {
                        current[to] = old;
                    }
                }
                4..7 => {
                    let low = self.binary_constant(Binary::And, current[from], 63);
                    let fails = self.compare_constant(Cond::Eq, low, 5);
                    self.check_with(fails, state);
                }
                7 => current[to] = self.binary(Binary::Xor, current[from], current[other]),
                8 if self.random.flip() => current[to] = current[from],
                8 => current.swap(to, from),
                9 => {
                    let condition = self.compare(Cond::Lt, current[from], current[other]);
                    current[to] = self.perhaps(condition, &[current[to]], &mut |this| {
                        let one = this.constant(ty, 1);
                        vec![this.checked_with(Checked::Add, current[from], one, state)]
                    })[0];
                }
                10 => current[to] = self.binary(Binary::TotalRem, current[from], current[other]),
                _ => {
                    self.trifle();
                    state = self.function.add_state(&current);
                }
            }
        }
        current
    }

    fn use_in_one_arm(&mut self) {
        let mark = self.mark();
        let made: Vec<Value> = (0..self.random.between(1, 4))
            .map(|_| {
                let ty = self.int_type();
                let value = self.fresh_int(ty);
                self.convert_int(value, Type::I64)
            })
            .collect();
        self.restore(mark);
        self.trifle();
        let condition = self.condition();
        let (usual, last) = (self.known_int(Type::I64), made[made.len() - 1]);
        let seen = match self.random.below(4) {
            0 => self.perhaps(condition, &[last], &mut |_| vec![usual]),
            1 if self.shape.weights.accesses != 0 => self.load_for_rare_edge(),
            _ => self.perhaps(condition, &[usual], &mut |this| {
                this.trifle();
                let inner = this.condition();
                this.choose(inner, &[Type::I64], &mut |this, holds| {
                    this.trifle();
                    let used = &made[usize::from(holds)..];
                    let add = |sum, &value| this.binary(Binary::Add, sum, value);
                    vec![used.iter().fold(usual, add)]
                })
            }),
        };
        self.keep_all(&seen);
    }

    fn empty_diamond(&mut self) {
        let ty = self.int_type();
        let (a, b, cond) = (
            self.known_int(ty),
            self.int(ty),
            self.random.pick(&Cond::ALL),
        );
        let (condition, then, or) = match self.random.below(4) {
            0 => (self.compare(cond, a, b), a, b),
            1 => (self.compare(cond, a, b), b, a),
            kind => (
                self.condition(),
                self.constant(ty, kind as i64 % 2),
                self.constant(ty, 1 - kind as i64 % 2),
            ),
        };
        let same = self.known_int(Type::I64);
        let seen = if self.random.one_in(6) {
            let (join, seen) = self.block_with(&[Type::I64, ty]);
            let (arm, passed) = self.block_with(&[ty]);
            let ways = [self.way(arm, &[then]), self.way(join, &[same, or])];
            self.branch(condition, ways);
            self.block = arm;
            self.builder().jump(join, &[same, passed[0]]);
            self.block = join;
            seen
        } else if self.random.flip() {
            self.perhaps(condition, &[same, or], &mut |_| vec![same, then])
        } else {
            self.choose(condition, &[Type::I64, ty], &mut |_, holds| {
                vec![same, if holds { then } else { or }]
            })
        };
        self.keep_all(&seen);
    }
}
