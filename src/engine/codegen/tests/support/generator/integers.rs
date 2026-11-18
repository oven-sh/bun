//! Expressions of integers.

use bun_engine_asm::{Cond, FloatCond, Sign, Size};
use bun_engine_codegen::ir::{Binary, Op, Type, Unary, Value, Wide};

use super::{Class, Generator, constants};

pub(super) const SIGNS: [Sign; 2] = [Sign::Signed, Sign::Unsigned];

pub(super) fn width(ty: Type) -> i64 {
    ty.width().bits().into()
}

impl Generator<'_> {
    /// Often one that has to do with another in the program.
    pub(super) fn number(&mut self, ty: Type) -> i64 {
        let favourite = self.random.pick(&self.favourite_constants);
        let number = match self.random.below(16) {
            0..4 => favourite,
            4 => favourite.wrapping_add(self.random.pick(&[-1, 1])),
            5 => favourite.wrapping_neg(),
            6 => !favourite,
            _ => constants::integer(ty, &mut self.random),
        };
        self.remarkable.push(number);
        if self.random.one_in(4) {
            let replaced = self.random.below(self.favourite_constants.len());
            self.favourite_constants[replaced] = number;
        }
        if ty == Type::I32 {
            (number as i32).into()
        } else {
            number
        }
    }

    pub(super) fn int_constant(&mut self, ty: Type) -> Value {
        let number = self.number(ty);
        self.constant(ty, number)
    }

    pub(super) fn may_nest(&self) -> bool {
        self.depth < self.shape.expression_depth
    }

    pub(super) fn int(&mut self, ty: Type) -> Value {
        match self.random.below(100) {
            0..15 => self.int_constant(ty),
            15..45 if self.may_nest() => {
                let fresh = self.fresh_int(ty);
                if self
                    .scope
                    .values
                    .last()
                    .unwrap()
                    .class
                    .has_determined_bits()
                {
                    self.count_as_used();
                }
                fresh
            }
            _ => self.known_int(ty),
        }
    }

    /// Unlikely to be a constant.
    pub(super) fn known_int(&mut self, ty: Type) -> Value {
        let wanted = if self.leaks() {
            Class::Loose(ty)
        } else {
            Class::Data(ty)
        };
        if let Some((found, _)) = self.find(|known| known.satisfies(wanted)) {
            return found;
        }
        let other = if ty == Type::I32 {
            Type::I64
        } else {
            Type::I32
        };
        match self.find(|known| known.satisfies(Class::Data(other))) {
            Some((found, _)) => self.convert_int(found, ty),
            None => self.int_constant(ty),
        }
    }

    pub(super) fn convert_int(&mut self, value: Value, to: Type) -> Value {
        match (self.type_of(value), to) {
            (Type::I32, Type::I64) => {
                let sign = self.random.pick(&SIGNS);
                self.unary(Unary::Widen(sign), to, value)
            }
            (Type::I64, Type::I32) => self.unary(Unary::Wrap, to, value),
            _ => value,
        }
    }

    pub(super) fn shift_amount(&mut self, ty: Type) -> Value {
        match self.random.below(10) {
            0..6 => {
                let amount = self.constant_amount(ty);
                self.function.const32(amount as i32)
            }
            6 => self.int_constant(Type::I32),
            7 => {
                let amount = self.int(Type::I32);
                let mask = self.random.pick(&[7, 15, 31, 63, 127, 255, width(ty) - 1]);
                self.binary_constant(Binary::And, amount, mask)
            }
            _ => self.int(Type::I32),
        }
    }

    pub(super) fn constant_amount(&mut self, ty: Type) -> i64 {
        let edges = [
            1,
            2,
            3,
            8,
            16,
            24,
            31,
            32,
            48,
            56,
            width(ty) - 1,
            width(ty) - 8,
            width(ty) - 16,
        ];
        if self.random.flip() {
            self.random.pick(&edges) % width(ty)
        } else {
            self.random.between(0, width(ty) - 1)
        }
    }

    pub(super) fn fresh_int(&mut self, ty: Type) -> Value {
        self.depth += 1;
        let (value, class) = self.int_expression(ty);
        self.depth -= 1;
        self.keep(value, class);
        if class.has_determined_bits() {
            value
        } else {
            self.known_int(ty)
        }
    }

    fn int_expression(&mut self, ty: Type) -> (Value, Class) {
        use Binary::*;
        let has_floats = self.shape.weights.floats != 0;
        let value = match self.random.below(100) {
            0..26 => {
                let op = self
                    .random
                    .pick(&[Add, Add, Sub, Sub, Mul, And, And, Or, Xor]);
                let (a, b) = (self.int(ty), self.int(ty));
                self.binary(op, a, b)
            }
            26..36 => {
                let op = self
                    .random
                    .pick(&[Shl, Shl, Shr, Shr, Sar, Sar, RotateLeft, RotateRight]);
                let (a, amount) = (self.int(ty), self.shift_amount(ty));
                self.binary(op, a, amount)
            }
            36..44 => {
                let size = self.random.pick(&[Size::S8, Size::S16]);
                let swapped = self.random.pick(&[Size::S16, Size::S32, ty.width().size()]);
                let op = self.random.pick(&[
                    Unary::Neg,
                    Unary::Neg,
                    Unary::CountLeadingZeros,
                    Unary::CountTrailingZeros,
                    Unary::CountOnes,
                    Unary::SwapBytes(swapped),
                    Unary::SignExtend(size),
                    Unary::SignExtend(size),
                    Unary::Opaque,
                ]);
                let a = self.int(ty);
                self.unary(op, ty, a)
            }
            44..52 => {
                let from = self.int(if ty == Type::I32 {
                    Type::I64
                } else {
                    Type::I32
                });
                self.convert_int(from, ty)
            }
            52..59 if ty == Type::I32 => return (self.comparison(), Class::BOOLEAN),
            59..64 => {
                let (condition, then, or) = (self.condition(), self.int(ty), self.int(ty));
                self.select(condition, then, or)
            }
            64..69 => self.division(ty),
            69 => {
                let (sign, a, b) = (self.random.pick(&SIGNS), self.int(ty), self.int(ty));
                self.binary(MulHigh(sign), a, b)
            }
            70 | 71 if ty == Type::I64 => self.wide_arithmetic(),
            72..76 if self.shape.weights.accesses != 0 => self.load(ty),
            76..80 if has_floats => return self.int_from_float(ty),
            80..83 if self.shape.weights.vectors != 0 => self.int_from_vector(ty),
            83 if ty == Type::I64 => {
                let register = self.random.pick(&self.registers.pinned);
                return (self.function.pinned(register), Class::Data(ty));
            }
            84 => {
                let below = self.random.pick(&[2, 4, 8, 13, 100]);
                let index = self.fresh_index(ty, below);
                return (
                    index,
                    Class::Index {
                        ty,
                        below,
                        is_guarded: false,
                    },
                );
            }
            _ => self.pattern(ty),
        };
        (value, Class::Data(ty))
    }

    fn wide_arithmetic(&mut self) -> Value {
        let [a, b, c, d] = [(); 4].map(|()| self.int(Type::I64));
        let tuple = if self.random.flip() {
            let op = self.random.pick(&[Wide::Add, Wide::Sub]);
            self.emit(Op::Wide(op, [a, b, c, d]), Type::Tuple)
        } else {
            let sign = self.random.pick(&SIGNS);
            self.emit(Op::MulWide(sign, [a, b]), Type::Tuple)
        };
        let position = self.random.below(2) as u32;
        self.extract_half(tuple, position)
    }

    pub(super) fn extract_half(&mut self, tuple: Value, position: u32) -> Value {
        if self.random.flip() {
            let other = self.builder().extract(tuple, 1 - position);
            self.keep(other, Class::Data(Type::I64));
        }
        self.builder().extract(tuple, position)
    }

    pub(super) fn fresh_divisor(&mut self, ty: Type) -> Value {
        let divisor = match self.random.below(6) {
            0..3 => {
                let number = self.number(ty);
                return self.constant(ty, if matches!(number, 0 | -1) { 7 } else { number });
            }
            3 => {
                let (one, amount) = (self.constant(ty, 1), self.int(Type::I32));
                self.binary(Binary::Shl, one, amount)
            }
            4 => {
                let any = self.int(ty);
                let halved = self.binary_constant(Binary::Shr, any, 1);
                self.binary_constant(Binary::Or, halved, 1)
            }
            _ => {
                let any = self.int(ty);
                let masked = self.binary_constant(Binary::And, any, 0xff);
                self.binary_constant(Binary::Add, masked, 1)
            }
        };
        self.keep(divisor, Class::Divisor(ty))
    }

    pub(super) fn division(&mut self, ty: Type) -> Value {
        use Binary::*;
        let mut dividend = self.int(ty);
        if self.random.one_in(4) {
            dividend = self.narrowed(dividend);
        }
        match self.random.below(8) {
            0 | 1 => {
                let (op, divisor) = (self.random.pick(&[TotalDiv, TotalRem]), self.int(ty));
                self.binary(op, dividend, divisor)
            }
            2 => {
                let odd = self.binary_constant(Or, dividend, 1);
                let op = self.random.pick(&[Div, Rem, UnsignedDiv, UnsignedRem]);
                self.binary_constant(op, odd, -1)
            }
            _ => {
                let divisor = self.value_of(Class::Divisor(ty));
                let op =
                    self.random
                        .pick(&[Div, Rem, UnsignedDiv, UnsignedRem, TotalDiv, TotalRem]);
                let result = self.binary(op, dividend, divisor);
                if self.random.one_in(5) && matches!(op, Div | UnsignedDiv) {
                    self.learn(result, Class::Data(ty));
                    let product = self.commutative(Mul, result, divisor);
                    return self.binary(Sub, dividend, product);
                }
                result
            }
        }
    }

    /// Has a range that is easy to see.
    pub(super) fn narrowed(&mut self, value: Value) -> Value {
        let ty = self.type_of(value);
        match self.random.below(8) {
            0 | 1 => {
                let mask = self.random.pick(&[
                    1,
                    3,
                    0xf,
                    0x7f,
                    0xff,
                    0xfff,
                    0x7fff,
                    0xffff,
                    0x3fff_ffff,
                    0x7fff_ffff,
                ]);
                self.binary_constant(Binary::And, value, mask)
            }
            2 => {
                let size = self.random.pick(&[Size::S8, Size::S16]);
                self.unary(Unary::SignExtend(size), ty, value)
            }
            3 | 4 => {
                let op = self.random.pick(&[Binary::Shr, Binary::Sar]);
                let amount = self
                    .random
                    .between(1, width(ty) - 1)
                    .max(self.random.between(1, width(ty) - 1));
                self.binary_constant(op, value, amount)
            }
            5 if ty == Type::I64 => {
                let narrow = self.unary(Unary::Wrap, Type::I32, value);
                self.convert_int(narrow, ty)
            }
            6 if self.shape.weights.accesses != 0 => {
                let (size, sign) = (
                    self.random.pick(&[Size::S8, Size::S16]),
                    self.random.pick(&SIGNS),
                );
                let loaded = self.load_narrow(size, sign);
                self.convert_int(loaded, ty)
            }
            _ => {
                let op = self.random.pick(&[
                    Unary::CountLeadingZeros,
                    Unary::CountTrailingZeros,
                    Unary::CountOnes,
                ]);
                self.unary(op, ty, value)
            }
        }
    }

    /// In range whichever way control has come.
    pub(super) fn fresh_index(&mut self, ty: Type, below: u32) -> Value {
        let bits = below.ilog2();
        let index = match self.random.below(10) {
            0 => {
                let number = self.random.below(below as usize);
                return self.constant(ty, number as i64);
            }
            1 if bits != 0 => {
                let any = self.int(ty);
                self.binary_constant(Binary::Shr, any, width(ty) - i64::from(bits))
            }
            2 => {
                let any = self.int(ty);
                self.binary_constant(Binary::UnsignedRem, any, below.into())
            }
            3 => {
                let any = self.known_int(ty);
                let fits = self.compare_constant(Cond::Below, any, below.into());
                let last = self.constant(ty, i64::from(below) - 1);
                self.select(fits, any, last)
            }
            _ => {
                let any = self.int(ty);
                self.binary_constant(Binary::And, any, (1 << bits) - 1)
            }
        };
        self.learn(
            index,
            Class::Index {
                ty,
                below,
                is_guarded: false,
            },
        );
        index
    }

    pub(super) fn comparison(&mut self) -> Value {
        let cond = self.random.pick(&Cond::ALL);
        let ty = self.int_type();
        match self.random.below(12) {
            0 | 1 if self.shape.weights.floats != 0 => {
                let (cond, ty) = (self.random.pick(&FloatCond::ALL), self.float_type());
                let (a, b) = (self.float(ty).0, self.float(ty).0);
                self.float_compare(cond, a, b)
            }
            2 | 3 => {
                let any = self.int(ty);
                let (narrow, limit) = (self.narrowed(any), self.number(ty));
                self.compare_constant(cond, narrow, limit)
            }
            4 => {
                let any = self.known_int(ty);
                let limit = self.random.pick(&[0, 0, 1, -1]);
                self.compare_constant(cond, any, limit)
            }
            5 | 6 => self.comparison_pattern(),
            _ => {
                let (a, b) = (self.int(ty), self.int(ty));
                self.compare(cond, a, b)
            }
        }
    }

    pub(super) fn boolean(&mut self) -> Value {
        if (self.random.flip() || !self.may_nest())
            && let Some((found, _)) = self.find(|known| known.satisfies(Class::BOOLEAN))
        {
            return found;
        }
        self.depth += 1;
        let boolean = match self.random.below(8) {
            0 | 1 if self.may_nest() => {
                let op = self.random.pick(&[Binary::And, Binary::Or, Binary::Xor]);
                let (a, b) = (self.boolean(), self.boolean());
                self.binary(op, a, b)
            }
            2 if self.may_nest() => {
                let boolean = self.boolean();
                self.negate(boolean)
            }
            _ => self.comparison(),
        };
        self.depth -= 1;
        self.learn(boolean, Class::BOOLEAN);
        boolean
    }

    pub(super) fn negate(&mut self, boolean: Value) -> Value {
        match self.random.below(4) {
            0 => self.binary_constant(Binary::Xor, boolean, 1),
            1 => {
                let (zero, one) = (self.function.const32(0), self.function.const32(1));
                self.select(boolean, zero, one)
            }
            _ => self.compare_constant(Cond::Eq, boolean, 0),
        }
    }

    /// An integer to branch on.
    pub(super) fn condition(&mut self) -> Value {
        let condition = match self.random.below(16) {
            0..3 if !self.scope.conditions.is_empty() => {
                let recent = self.scope.conditions.len().saturating_sub(3);
                let known = self.random.pick(&self.scope.conditions[recent..]);
                match self.random.below(6) {
                    0 | 1 => known,
                    2 => self.compare_constant(Cond::Eq, known, 0),
                    3 => self.compare_constant(Cond::Ne, known, 0),
                    _ => {
                        let op = self.random.pick(&[Binary::And, Binary::Or]);
                        let known = self.convert_int(known, Type::I32);
                        let other = if self.random.flip() {
                            self.boolean()
                        } else {
                            self.known_int(Type::I32)
                        };
                        self.commutative(op, known, other)
                    }
                }
            }
            3 | 4 => {
                let ty = self.int_type();
                let any = self.known_int(ty);
                let mask = if self.random.flip() {
                    1 << self.random.below(4)
                } else {
                    self.number(ty)
                };
                self.binary_constant(Binary::And, any, mask)
            }
            5 => {
                let ty = self.int_type();
                self.int(ty)
            }
            6 => {
                let boolean = self.boolean();
                self.convert_int(boolean, Type::I64)
            }
            _ => self.boolean(),
        };
        self.scope.conditions.push(condition);
        condition
    }

    /// A comparison, and another of the same operands to make later.
    pub(super) fn related_conditions(&mut self) -> (Value, Op) {
        let is_float = self.shape.weights.floats != 0 && self.random.one_in(3);
        let (ty, relation) = (self.int_type(), self.random.below(4));
        if is_float {
            let (cond, other) = (
                self.random.pick(&FloatCond::ALL),
                self.random.pick(&FloatCond::ALL),
            );
            let (a, b) = (self.float(Type::F64).0, self.float(Type::F64).0);
            let later = [cond, cond.inverted(), cond.inverted(), other][relation];
            return (
                self.float_compare(cond, a, b),
                Op::FloatCompare(later, [a, b]),
            );
        }
        let (cond, other) = (self.random.pick(&Cond::ALL), self.random.pick(&Cond::ALL));
        let (a, b) = (self.known_int(ty), self.int(ty));
        let later = [cond, cond.inverted(), cond.inverted(), other][relation];
        (self.compare(cond, a, b), Op::Compare(later, [a, b]))
    }

    pub(super) fn unlikely_condition(&mut self) -> Value {
        let ty = self.int_type();
        let any = self.known_int(ty);
        let condition = match self.random.below(8) {
            0 | 1 => {
                let number = self.number(ty);
                self.compare_constant(Cond::Eq, any, number)
            }
            2 => {
                let mask = self.random.pick(&[15, 31, 0xff]);
                let (low, number) = (
                    self.binary_constant(Binary::And, any, mask),
                    self.random.between(0, mask),
                );
                self.compare_constant(Cond::Eq, low, number)
            }
            3 => {
                let low = self.binary_constant(Binary::And, any, 63);
                let cond = self
                    .random
                    .pick(&[Cond::Above, Cond::AboveEq, Cond::Gt, Cond::Ge]);
                let limit = self.random.between(56, 65);
                self.compare_constant(cond, low, limit)
            }
            4 => {
                let other = self.known_int(ty);
                let moved = self.binary_constant(Binary::Add, other, 3);
                self.compare(Cond::Eq, any, moved)
            }
            5 => {
                let (a, b) = (self.unlikely_condition(), self.boolean());
                self.commutative(Binary::And, a, b)
            }
            6 if self.may_nest() => {
                self.depth += 1;
                let (a, b) = (self.unlikely_condition(), self.unlikely_condition());
                self.depth -= 1;
                self.binary(Binary::Or, a, b)
            }
            _ => {
                let limit = -(1 << (width(ty) - 2));
                self.compare_constant(Cond::Lt, any, limit)
            }
        };
        self.learn(condition, Class::BOOLEAN);
        condition
    }
}
