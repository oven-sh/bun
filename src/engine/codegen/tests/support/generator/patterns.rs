//! Shapes that rules and instructions are made for, and that chance would seldom produce.

use bun_engine_asm::{Cond, Size};
use bun_engine_codegen::ir::Binary::*;
use bun_engine_codegen::ir::{Binary, Type, Unary, Value};

use super::integers::{SIGNS, width};
use super::{Class, Generator};

impl Generator<'_> {
    fn not(&mut self, value: Value) -> Value {
        let ones = self.constant(self.type_of(value), -1);
        self.commutative(Xor, value, ones)
    }

    fn neg(&mut self, value: Value) -> Value {
        let ty = self.type_of(value);
        if self.random.one_in(4) {
            let zero = self.constant(ty, 0);
            self.binary(Sub, zero, value)
        } else {
            self.unary(Unary::Neg, ty, value)
        }
    }

    fn either_order(&mut self, op: Binary, a: Value, b: Value) -> Value {
        if self.random.flip() {
            self.binary(op, a, b)
        } else {
            self.binary(op, b, a)
        }
    }

    fn low_mask(&mut self, ty: Type) -> i64 {
        let bits = self.constant_amount(ty).max(1);
        (1i64 << bits).wrapping_sub(1)
    }

    fn widened(&mut self) -> Value {
        let (sign, narrow) = (self.random.pick(&SIGNS), self.int(Type::I32));
        self.unary(Unary::Widen(sign), Type::I64, narrow)
    }

    /// Spends instructions on what is above the low `bits` bits.
    pub(super) fn with_irrelevant_upper_bits(&mut self, ty: Type, bits: u32) -> Value {
        let (any, low) = (self.int(ty), (1i64 << bits) - 1);
        match self.random.below(6) {
            0 => self.binary_constant(And, any, low),
            1 => {
                let mask = self.number(ty) | low;
                self.binary_constant(And, any, mask)
            }
            2 => {
                let (op, mask) = (self.random.pick(&[Or, Xor, Add]), self.number(ty) & !low);
                self.binary_constant(op, any, mask)
            }
            3 => {
                let size = self.random.pick(&[Size::S8, Size::S16]);
                self.unary(Unary::SignExtend(size), ty, any)
            }
            4 if ty == Type::I64 => self.widened(),
            _ => {
                let wide = self.int(Type::I64);
                if ty == Type::I32 {
                    self.unary(Unary::Wrap, ty, wide)
                } else {
                    wide
                }
            }
        }
    }

    pub(super) fn pattern(&mut self, ty: Type) -> Value {
        match self.random.below(8) {
            0 => self.shift_pattern(ty),
            1 => self.bitwise_pattern(ty),
            2 => self.arithmetic_pattern(ty),
            3 => self.select_pattern(ty),
            4 => self.extension_pattern(ty),
            5 => self.operand_pattern(ty),
            6 => self.constants_pattern(ty),
            _ => self.associative_tree(ty),
        }
    }

    fn shift_pattern(&mut self, ty: Type) -> Value {
        const SHIFTS: [Binary; 5] = [Shl, Shr, Sar, RotateLeft, RotateRight];
        let (x, amount) = (self.known_int(ty), self.constant_amount(ty));
        match self.random.below(10) {
            0..3 => {
                let (first, second) = (self.random.pick(&SHIFTS), self.random.pick(&SHIFTS));
                let other = if self.random.flip() {
                    amount
                } else {
                    self.constant_amount(ty)
                };
                let shifted = self.binary_constant(first, x, amount);
                self.binary_constant(second, shifted, other)
            }
            3 => {
                let (op, mask) = (self.random.pick(&SHIFTS), self.low_mask(ty));
                let shifted = self.binary_constant(op, x, amount);
                let mask = if self.random.one_in(3) {
                    mask << amount
                } else {
                    mask
                };
                self.binary_constant(And, shifted, mask)
            }
            4 => {
                let (op, mask) = (self.random.pick(&SHIFTS), self.low_mask(ty));
                let mask = self.random.pick(&[mask, !mask, mask << amount]);
                let masked = self.binary_constant(And, x, mask);
                self.binary_constant(op, masked, amount)
            }
            5 | 6 => {
                let y = if self.random.one_in(3) {
                    self.known_int(ty)
                } else {
                    x
                };
                let high = self.binary_constant(Shl, x, amount);
                let low = self.binary_constant(Shr, y, width(ty) - amount);
                let op = self.random.pick(&[Or, Or, Xor, Add]);
                self.commutative(op, high, low)
            }
            7 => {
                let by = self.known_int(Type::I32);
                let rest = if self.random.flip() {
                    let whole = self.constant(Type::I32, width(ty));
                    self.binary(Sub, whole, by)
                } else {
                    self.neg(by)
                };
                let (first, second) = self.random.pick(&[(Shl, Shr), (Shr, Shl)]);
                let (a, b) = (self.binary(first, x, by), self.binary(second, x, rest));
                let op = self.random.pick(&[Or, Or, Or, Xor]);
                self.commutative(op, a, b)
            }
            8 => {
                let by = self.int(Type::I32);
                let shifted = self.binary(Shr, x, by);
                self.binary_constant(And, shifted, 1)
            }
            _ => {
                let (one, by) = (self.constant(ty, 1), self.int(Type::I32));
                let bit = self.binary(Shl, one, by);
                match self.random.below(4) {
                    0 => {
                        let below = self.binary_constant(Add, bit, -1);
                        self.commutative(And, x, below)
                    }
                    1 => {
                        let others = self.not(bit);
                        self.commutative(And, x, others)
                    }
                    _ => {
                        let op = self.random.pick(&[And, Or, Xor, Mul]);
                        self.commutative(op, x, bit)
                    }
                }
            }
        }
    }

    fn bitwise_pattern(&mut self, ty: Type) -> Value {
        const BITWISE: [Binary; 3] = [And, Or, Xor];
        let (x, y, z) = (self.known_int(ty), self.known_int(ty), self.int(ty));
        let (inner, outer) = (self.random.pick(&BITWISE), self.random.pick(&BITWISE));
        match self.random.below(10) {
            0 | 1 => {
                let (a, b) = (self.commutative(inner, x, y), self.commutative(inner, x, z));
                self.binary(outer, a, b)
            }
            2 => {
                let (a, b) = (self.not(x), self.not(y));
                self.binary(outer, a, b)
            }
            3 => {
                let a = self.not(x);
                let with = self.random.pick(&[x, y, z]);
                self.commutative(outer, a, with)
            }
            4 => {
                let a = self.commutative(inner, x, y);
                self.commutative(outer, a, x)
            }
            5 => {
                let inverse = self.not(y);
                let (a, b) = (
                    self.commutative(And, x, y),
                    self.commutative(And, z, inverse),
                );
                let op = self.random.pick(&[Or, Xor, Add]);
                self.commutative(op, a, b)
            }
            6 => {
                let (mask, amount) = (self.low_mask(ty), self.constant_amount(ty));
                let kept = self.binary_constant(And, x, !(mask << amount));
                let inserted = if self.random.flip() {
                    let field = self.binary_constant(And, y, mask);
                    self.binary_constant(Shl, field, amount)
                } else {
                    let field = self.binary_constant(Shl, y, amount);
                    self.binary_constant(And, field, mask << amount)
                };
                self.commutative(Or, kept, inserted)
            }
            7 => {
                let other = if self.random.flip() {
                    self.binary_constant(Add, x, -1)
                } else {
                    self.neg(x)
                };
                self.commutative(outer, x, other)
            }
            8 => {
                let a = self.commutative(inner, x, y);
                self.not(a)
            }
            _ => {
                let other = self.random.pick(&BITWISE);
                let (a, b) = (self.commutative(inner, x, y), self.commutative(other, x, y));
                let op = self.random.pick(&[And, Or, Xor, Add, Sub]);
                self.either_order(op, a, b)
            }
        }
    }

    fn arithmetic_pattern(&mut self, ty: Type) -> Value {
        let (x, y, z) = (self.known_int(ty), self.known_int(ty), self.int(ty));
        let (inner, outer) = (self.random.pick(&[Add, Sub]), self.random.pick(&[Add, Sub]));
        match self.random.below(10) {
            0 | 1 => {
                let a = self.either_order(inner, x, y);
                let with = self.random.pick(&[x, y]);
                self.either_order(outer, a, with)
            }
            2 => {
                let (a, b) = (self.commutative(Mul, x, y), self.commutative(Mul, x, z));
                self.binary(outer, a, b)
            }
            3 => {
                let (a, op) = (self.neg(x), self.random.pick(&[Add, Sub, Mul]));
                let b = if self.random.one_in(3) {
                    self.neg(y)
                } else {
                    z
                };
                self.either_order(op, a, b)
            }
            4 => {
                let op = self.random.pick(&[Add, Sub, Mul]);
                let a = self.binary(op, x, z);
                self.neg(a)
            }
            5 => {
                let (a, number) = (self.not(x), self.random.pick(&[1, 1, -1, 5]));
                let b = self.constant(ty, number);
                self.either_order(outer, a, b)
            }
            6 => {
                let (a, b) = (
                    self.either_order(inner, x, y),
                    self.either_order(inner, x, z),
                );
                self.binary(outer, a, b)
            }
            7 => {
                let factor = self.number(ty);
                let a = self.binary_constant(Mul, x, factor);
                let b = if self.random.flip() {
                    x
                } else {
                    self.binary_constant(Shl, x, 2)
                };
                self.either_order(outer, a, b)
            }
            8 => {
                let sign = self.binary_constant(Sar, x, width(ty) - 1);
                let flipped = self.commutative(Xor, x, sign);
                self.binary(Sub, flipped, sign)
            }
            _ => {
                let twice = self.neg(x);
                if self.random.flip() {
                    self.neg(twice)
                } else {
                    self.not(twice)
                }
            }
        }
    }

    fn select_pattern(&mut self, ty: Type) -> Value {
        let (x, y) = (self.known_int(ty), self.int(ty));
        let cond = self.random.pick(&Cond::ALL);
        match self.random.below(10) {
            0 => {
                let holds = self.compare(cond, x, y);
                self.select(holds, x, y)
            }
            1 => {
                let (holds, negated) = (self.compare_constant(cond, x, 0), self.neg(x));
                self.select(holds, negated, x)
            }
            2 | 3 => {
                let [a, b] = [(); 2].map(|()| self.random.pick(&[0, 1, -1, 2, 8]));
                let (condition, a, b) =
                    (self.condition(), self.constant(ty, a), self.constant(ty, b));
                self.select(condition, a, b)
            }
            4 => {
                let changed = match self.random.below(4) {
                    0 => self.binary_constant(Add, y, 1),
                    1 => self.neg(y),
                    2 => self.not(y),
                    _ => self.binary_constant(Add, x, 1),
                };
                let condition = self.condition();
                if self.random.flip() {
                    self.select(condition, x, changed)
                } else {
                    self.select(condition, changed, x)
                }
            }
            5 => {
                let (condition, z) = (self.condition(), self.int(ty));
                let inner = self.select(condition, x, y);
                if self.random.flip() {
                    self.select(condition, inner, z)
                } else {
                    self.select(condition, z, inner)
                }
            }
            6 => {
                let (condition, [a, b, c]) =
                    (self.condition(), [(); 3].map(|()| self.int_constant(ty)));
                let chosen = self.select(condition, a, b);
                let op = self.random.pick(&[Add, Sub, And, Or, Xor, Mul]);
                self.either_order(op, chosen, c)
            }
            7 => {
                let zero = self.constant(ty, 0);
                if self.random.flip() {
                    self.select(x, x, zero)
                } else {
                    self.select(x, y, x)
                }
            }
            8 if ty == Type::I32 => {
                let (condition, a, b) = (self.boolean(), self.boolean(), self.random.between(0, 1));
                let b = self.constant(ty, b);
                if self.random.flip() {
                    self.select(condition, a, b)
                } else {
                    self.select(condition, b, a)
                }
            }
            _ => {
                let boolean = self.boolean();
                let condition = self.negate(boolean);
                self.select(condition, x, y)
            }
        }
    }

    fn extension_pattern(&mut self, ty: Type) -> Value {
        const OPS: [Binary; 6] = [Add, Sub, Mul, And, Or, Xor];
        let (size, other) = (
            self.random.pick(&[Size::S8, Size::S16]),
            self.random.pick(&[Size::S8, Size::S16]),
        );
        let op = self.random.pick(&OPS);
        match self.random.below(8) {
            0 => {
                let x = self.known_int(ty);
                let inner = self.unary(Unary::SignExtend(size), ty, x);
                self.unary(Unary::SignExtend(other), ty, inner)
            }
            1 => {
                let x = self.with_irrelevant_upper_bits(ty, size.bits().into());
                self.unary(Unary::SignExtend(size), ty, x)
            }
            2 => {
                let (x, mask) = (self.known_int(ty), self.low_mask(ty));
                let inner = self.unary(Unary::SignExtend(size), ty, x);
                let mask = self.random.pick(&[mask, 0xff, 0xffff, 0x7f, 0x80]);
                self.binary_constant(And, inner, mask)
            }
            3 | 4 if ty == Type::I32 => {
                let a = self.widened();
                let b = if self.random.flip() {
                    self.widened()
                } else {
                    self.int(Type::I64)
                };
                let wide = self.either_order(op, a, b);
                self.unary(Unary::Wrap, ty, wide)
            }
            5 if ty == Type::I32 => {
                let (a, amount) = (self.widened(), self.constant_amount(Type::I64));
                let op = self.random.pick(&[Shl, Shr, Sar]);
                let wide = self.binary_constant(op, a, amount);
                self.unary(Unary::Wrap, ty, wide)
            }
            3 | 4 => {
                let a = self.widened();
                let b = if self.random.flip() {
                    self.widened()
                } else {
                    self.int_constant(ty)
                };
                let product = self.either_order(op, a, b);
                if self.random.one_in(4) {
                    self.binary_constant(Shr, product, 32)
                } else {
                    product
                }
            }
            5 => {
                let (x, number) = (self.known_int(Type::I32), self.random.between(-4, 100));
                let narrow = self.narrowed(x);
                let changed = self.binary_constant(op, narrow, number);
                let sign = self.random.pick(&SIGNS);
                self.unary(Unary::Widen(sign), ty, changed)
            }
            6 => {
                let x = self.known_int(ty);
                let swapped = self.random.pick(&[Size::S16, Size::S32, ty.width().size()]);
                let inner = self.unary(Unary::SwapBytes(swapped), ty, x);
                self.unary(Unary::SwapBytes(swapped), ty, inner)
            }
            _ => {
                let x = self.known_int(ty);
                let inner = self.narrowed(x);
                self.narrowed(inner)
            }
        }
    }

    /// For instructions that do something to an operand on the way.
    fn operand_pattern(&mut self, ty: Type) -> Value {
        let (x, y) = (self.known_int(ty), self.int(ty));
        let op = self.random.pick(&[Add, Add, Sub, And, Or, Xor]);
        let operand = match self.random.below(8) {
            0 | 1 => {
                let (shift, amount) = (
                    self.random.pick(&[Shl, Shr, Sar, RotateRight]),
                    self.constant_amount(ty),
                );
                let shifted = self.binary_constant(shift, y, amount);
                if self.random.one_in(4) {
                    self.not(shifted)
                } else {
                    shifted
                }
            }
            2 => {
                let z = self.int(ty);
                self.binary(Mul, y, z)
            }
            3 if ty == Type::I64 => {
                let (wide, amount) = (self.widened(), self.random.between(0, 5));
                self.binary_constant(Shl, wide, amount)
            }
            4 if ty == Type::I64 => {
                let (a, b) = (self.widened(), self.widened());
                self.binary(Mul, a, b)
            }
            5 => {
                let (amount, number) = (self.random.between(0, 4), self.number(Type::I32));
                let scaled = self.binary_constant(Shl, y, amount);
                let sum = self.commutative(Add, x, scaled);
                return self.binary_constant(Add, sum, number);
            }
            6 if self.shape.weights.accesses != 0 => self.load(ty),
            _ => {
                let (narrow, amount) = (self.narrowed(y), self.random.between(0, 4));
                self.binary_constant(Shl, narrow, amount)
            }
        };
        self.either_order(op, x, operand)
    }

    fn constants_pattern(&mut self, ty: Type) -> Value {
        const OPS: [Binary; 7] = [Add, Sub, Mul, And, Or, Xor, Shl];
        let (inner, outer) = (self.random.pick(&OPS), self.random.pick(&OPS));
        let mut value = self.known_int(ty);
        for op in [inner, outer] {
            value = if op == Shl {
                let amount = self.constant_amount(ty);
                self.binary_constant(op, value, amount)
            } else {
                let constant = self.int_constant(ty);
                self.either_order(op, value, constant)
            };
        }
        value
    }

    fn associative_tree(&mut self, ty: Type) -> Value {
        let op = self.random.pick(&[Add, Add, Mul, And, Or, Xor]);
        let some = [(); 3].map(|()| self.known_int(ty));
        let mut trees: Vec<Value> = (0..self.random.between(3, 9))
            .map(|_| match self.random.below(8) {
                0 | 1 => self.int_constant(ty),
                2 => {
                    let leaf = self.random.pick(&some);
                    if op == Add {
                        self.neg(leaf)
                    } else {
                        self.not(leaf)
                    }
                }
                _ => self.random.pick(&some),
            })
            .collect();
        while trees.len() > 1 {
            let [a, b] = [(); 2].map(|()| trees.swap_remove(self.random.below(trees.len())));
            let subtracts = op == Add && self.random.one_in(4);
            let joined = self.binary(if subtracts { Sub } else { op }, a, b);
            if self.random.one_in(12) {
                self.keep(joined, Class::Data(ty));
            }
            trees.push(joined);
        }
        trees[0]
    }

    pub(super) fn comparison_pattern(&mut self) -> Value {
        let (ty, cond) = (self.int_type(), self.random.pick(&Cond::ALL));
        let equality = self.random.pick(&[Cond::Eq, Cond::Ne]);
        let (x, y) = (self.known_int(ty), self.known_int(ty));
        match self.random.below(12) {
            0 => {
                let (op, cond) = (
                    self.random.pick(&[Sub, Xor, Add]),
                    self.random.pick(&[cond, equality]),
                );
                let difference = self.binary(op, x, y);
                self.compare_constant(cond, difference, 0)
            }
            1 => {
                let (op, cond) = (
                    self.random.pick(&[Add, Sub, Xor, And, Or, Mul]),
                    self.random.pick(&[cond, equality]),
                );
                let (a, b) = (self.int_constant(ty), self.int_constant(ty));
                let changed = self.either_order(op, x, a);
                self.compare(cond, changed, b)
            }
            2 => {
                let mask = if self.random.flip() {
                    1 << self.constant_amount(ty)
                } else {
                    self.number(ty)
                };
                let masked = self.binary_constant(And, x, mask);
                let with = self.random.pick(&[0, mask]);
                self.compare_constant(equality, masked, with)
            }
            3 => {
                let (a, b) = (
                    self.widened(),
                    if self.random.flip() {
                        self.widened()
                    } else {
                        self.int_constant(Type::I64)
                    },
                );
                self.compare(cond, a, b)
            }
            4 => {
                let (boolean, number) = (self.boolean(), self.random.between(-1, 2));
                self.compare_constant(cond, boolean, number)
            }
            5 | 6 => {
                let (other, op) = (
                    self.random.pick(&Cond::ALL),
                    self.random.pick(&[And, Or, Xor]),
                );
                let (a, b) = (self.compare(cond, x, y), self.compare(other, x, y));
                self.binary(op, a, b)
            }
            7 => {
                let (other, op) = (self.random.pick(&Cond::ALL), self.random.pick(&[And, Or]));
                let (least, span) = (self.random.pick(&[0, 0, 5, -3]), self.random.between(0, 40));
                let (a, b) = (
                    self.compare_constant(cond, x, least),
                    self.compare_constant(other, x, least + span),
                );
                self.commutative(op, a, b)
            }
            8 => {
                let edge = 1i64 << (width(ty) - 1);
                let limit = self.random.pick(&[
                    edge,
                    edge.wrapping_sub(1),
                    edge + 1,
                    edge.wrapping_sub(2),
                    -1,
                    -2,
                    0,
                    1,
                ]);
                self.compare_constant(cond, x, limit)
            }
            9 => {
                let (op, z, cond) = (
                    self.random.pick(&[Add, Sub, Xor]),
                    self.int(ty),
                    self.random.pick(&[cond, equality]),
                );
                let a = self.either_order(op, x, y);
                let b = if self.random.flip() {
                    x
                } else {
                    self.either_order(op, x, z)
                };
                self.compare(cond, a, b)
            }
            10 => {
                let (condition, [a, b]) =
                    (self.condition(), [(); 2].map(|()| self.int_constant(ty)));
                let (chosen, with) = (self.select(condition, a, b), self.random.pick(&[a, b]));
                self.compare(cond, chosen, with)
            }
            _ => {
                let op = self.random.pick(&[
                    Unary::Neg,
                    Unary::CountOnes,
                    Unary::CountLeadingZeros,
                    Unary::SignExtend(Size::S8),
                    Unary::SwapBytes(ty.width().size()),
                ]);
                let (changed, number) = (
                    self.unary(op, ty, x),
                    self.random.pick(&[0, 0, 1, width(ty)]),
                );
                let cond = self.random.pick(&[cond, equality]);
                self.compare_constant(cond, changed, number)
            }
        }
    }
}
