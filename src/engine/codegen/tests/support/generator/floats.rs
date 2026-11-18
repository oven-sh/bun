//! Expressions of floats, and conversions.

use bun_engine_asm::{FloatCond, Rounding, Sign};
use bun_engine_codegen::ir::{Binary, Type, Unary, Value};

use super::integers::SIGNS;
use super::{Class, Generator, constants};

fn int_type_like(ty: Type) -> Type {
    ty.width().into()
}

impl Generator<'_> {
    fn float_number(&mut self, ty: Type, number: f64) -> Value {
        if ty == Type::F32 {
            self.function.const_f32(number as f32)
        } else {
            self.function.const_f64(number)
        }
    }

    fn float_constant(&mut self, ty: Type) -> Value {
        let bits = constants::float(ty, &mut self.random);
        self.function.constant(ty, bits)
    }

    pub(super) fn float(&mut self, ty: Type) -> (Value, Class) {
        match self.random.below(100) {
            0..15 => (self.float_constant(ty), Class::Data(ty)),
            15..45 if self.may_nest() => {
                let fresh = self.fresh_float(ty);
                self.count_as_used();
                fresh
            }
            _ => match self.find(|known| known.satisfies(Class::Loose(ty))) {
                Some(found) => found,
                None if self.may_nest() => self.fresh_float(ty),
                None => (self.float_constant(ty), Class::Data(ty)),
            },
        }
    }

    pub(super) fn fresh_float(&mut self, ty: Type) -> (Value, Class) {
        self.depth += 1;
        let (value, class) = self.float_expression(ty);
        self.depth -= 1;
        (self.keep(value, class), class)
    }

    fn promoted(&mut self) -> Value {
        if self.random.one_in(4) {
            let bits = constants::float(Type::F32, &mut self.random);
            return self.function.const_f64(f32::from_bits(bits as u32).into());
        }
        let narrow = self.float(Type::F32).0;
        let promoted = self.unary(Unary::Promote, Type::F64, narrow);
        self.learn(promoted, Class::Loose(Type::F64));
        promoted
    }

    pub(super) fn fresh_narrowable(&mut self) -> Value {
        match self.random.below(12) {
            0 => self.float(Type::F64).0,
            1 => self.float_constant(Type::F64),
            2 | 3 => {
                let op = self.random.pick(&[Binary::Add, Binary::Mul, Binary::Div]);
                let (a, b) = (self.promoted(), self.promoted());
                self.binary(op, a, b)
            }
            _ => self.promoted(),
        }
    }

    /// For a parameter.
    pub(super) fn use_narrowable(&mut self, param: Value) {
        let wide = match self.random.below(4) {
            0 => {
                let other = self.promoted();
                self.commutative(Binary::Add, param, other)
            }
            _ => param,
        };
        let narrow = self.unary(Unary::Demote, Type::F32, wide);
        self.keep(narrow, Class::Loose(Type::F32));
        match self.random.below(3) {
            0 => {}
            1 => self.learn(param, Class::Narrowable),
            _ => {
                self.keep(param, Class::Narrowable);
            }
        }
    }

    /// What a language without floats of 32 bits makes of operations on them.
    fn through_doubles(&mut self) -> Value {
        use Binary::*;
        let a = self.promoted();
        let wide = match self.random.below(10) {
            0 => {
                let rounding = self.rounding();
                let op = self.random.pick(&[
                    Unary::Sqrt,
                    Unary::Neg,
                    Unary::Abs,
                    Unary::Round(rounding),
                ]);
                self.unary(op, Type::F64, a)
            }
            1 => {
                let (condition, b) = (self.condition(), self.promoted());
                self.select(condition, a, b)
            }
            2 => a,
            _ => {
                let op = self.random.pick(&[Add, Sub, Mul, Div, Min, Max, CopySign]);
                let b = self.promoted();
                let b = if op == CopySign {
                    self.settle(b, Class::Loose(Type::F64))
                } else {
                    b
                };
                self.binary(op, a, b)
            }
        };
        if self.random.one_in(5) {
            self.keep(wide, Class::Loose(Type::F64));
        }
        self.unary(Unary::Demote, Type::F32, wide)
    }

    fn rounding(&mut self) -> Rounding {
        self.random.pick(&[
            Rounding::Down,
            Rounding::Up,
            Rounding::TowardZero,
            Rounding::Nearest,
        ])
    }

    fn float_expression(&mut self, ty: Type) -> (Value, Class) {
        use Binary::*;
        let (data, loose) = (Class::Data(ty), Class::Loose(ty));
        match self.random.below(100) {
            0..26 => {
                let op = self
                    .random
                    .pick(&[Add, Add, Sub, Sub, Mul, Mul, Div, Min, Max]);
                let (a, b) = (self.float(ty).0, self.float(ty).0);
                (self.binary(op, a, b), loose)
            }
            26..34 => {
                let op = self.random.pick(&[Add, Sub, Mul, Div, Min, Max]);
                let number = self.random.pick(&[
                    0.0,
                    -0.0,
                    1.0,
                    -1.0,
                    2.0,
                    0.5,
                    8.0,
                    -4.0,
                    f64::INFINITY,
                    f64::NEG_INFINITY,
                ]);
                let (a, b) = (self.float(ty).0, self.float_number(ty, number));
                (
                    if self.random.one_in(4) {
                        self.binary(op, b, a)
                    } else {
                        self.binary(op, a, b)
                    },
                    loose,
                )
            }
            34..44 => {
                let op = self.random.pick(&[
                    Unary::Neg,
                    Unary::Abs,
                    Unary::Opaque,
                    Unary::Neg,
                    Unary::Abs,
                ]);
                let (a, class) = self.float(ty);
                (self.unary(op, ty, a), class)
            }
            44..52 => {
                let rounding = self.rounding();
                let op = self.random.pick(&[
                    Unary::Sqrt,
                    Unary::Round(rounding),
                    Unary::Round(rounding),
                ]);
                let a = self.float(ty).0;
                (self.unary(op, ty, a), loose)
            }
            52..56 => {
                let ((a, class), sign) = (self.float(ty), self.data(ty));
                (self.binary(CopySign, a, sign), class)
            }
            56..60 => {
                let sign = 1u64 << (ty.width().bits() - 1);
                let mask = self.random.pick(&[sign, sign - 1, 0, sign | (sign - 1)]);
                let (op, a) = (self.random.pick(&[And, Or, Xor]), self.data(ty));
                let b = if self.random.one_in(3) {
                    self.data(ty)
                } else {
                    self.function.constant(ty, mask)
                };
                (self.commutative(op, a, b), data)
            }
            60..66 => {
                let (condition, (then, first), (or, second)) =
                    (self.condition(), self.float(ty), self.float(ty));
                (
                    self.select(condition, then, or),
                    if [first, second] == [data; 2] {
                        data
                    } else {
                        loose
                    },
                )
            }
            66..72 => {
                let (from, sign) = (self.int_type(), self.random.pick(&SIGNS));
                let int = self.int(from);
                let int = if self.random.flip() {
                    self.narrowed(int)
                } else {
                    int
                };
                (self.unary(Unary::IntToFloat(sign), ty, int), data)
            }
            72..76 => {
                let bits = self.int(int_type_like(ty));
                (self.unary(Unary::Bitcast, ty, bits), data)
            }
            76..79 if self.shape.weights.accesses != 0 => (self.load(ty), data),
            79..82 if self.shape.weights.vectors != 0 => self.float_from_vector(ty),
            82 if ty == Type::F64 && self.target.has_half_floats() => {
                let bits = self.int(Type::I32);
                (self.unary(Unary::HalfBitsToFloat, ty, bits), loose)
            }
            83 | 84 if ty == Type::F64 => {
                let a = self.float(ty).0;
                (self.unary(Unary::CanonicalizeNan, ty, a), data)
            }
            85 | 86 => {
                let cond = self.random.pick(&FloatCond::ALL);
                let ((a, first), (b, second)) = (self.float(ty), self.float(ty));
                let holds = self.float_compare(cond, a, b);
                (
                    self.select(holds, a, b),
                    if [first, second] == [data; 2] {
                        data
                    } else {
                        loose
                    },
                )
            }
            87..94 if ty == Type::F32 => (self.through_doubles(), loose),
            _ if ty == Type::F32 => {
                let wide = self.float(Type::F64).0;
                (self.unary(Unary::Demote, ty, wide), loose)
            }
            _ => {
                let narrow = if self.random.flip() {
                    self.through_doubles()
                } else {
                    self.float(Type::F32).0
                };
                (self.unary(Unary::Promote, ty, narrow), loose)
            }
        }
    }

    /// From 0 to 1000.
    fn clamped(&mut self, value: Value) -> Value {
        let ty = self.type_of(value);
        let (least, greatest) = (self.float_number(ty, 0.0), self.float_number(ty, 1000.0));
        let is_above = self.float_compare(FloatCond::Gt, value, least);
        let above = self.select(is_above, value, least);
        self.commutative(Binary::Min, above, greatest)
    }

    pub(super) fn int_from_float(&mut self, ty: Type) -> (Value, Class) {
        let (from, sign) = (self.float_type(), self.random.pick(&SIGNS));
        let value = match self.random.below(12) {
            0 | 1 => {
                let float = self.data(if ty == Type::I32 {
                    Type::F32
                } else {
                    Type::F64
                });
                self.unary(Unary::Bitcast, ty, float)
            }
            2 => {
                let float = self
                    .float(if ty == Type::I32 {
                        Type::F32
                    } else {
                        Type::F64
                    })
                    .0;
                return (self.unary(Unary::Bitcast, ty, float), Class::Loose(ty));
            }
            3 | 4 => {
                let float = self.float(from).0;
                let clamped = self.clamped(float);
                self.unary(Unary::FloatToInt(sign), ty, clamped)
            }
            5 => {
                let float = self.float(from).0;
                return (
                    self.unary(Unary::FloatToInt(sign), ty, float),
                    Class::Loose(ty),
                );
            }
            6 => {
                let int = self.int(Type::I32);
                let float = self.unary(Unary::IntToFloat(Sign::Signed), Type::F64, int);
                self.unary(Unary::FloatToInt(Sign::Signed), ty, float)
            }
            7 if ty == Type::I32 && self.target.has_float_to_int32_modular() => {
                let float = self.float(Type::F64).0;
                self.unary(Unary::FloatToInt32Modular, ty, float)
            }
            8 if ty == Type::I32 && self.target.has_half_floats() => {
                let float = self.float(Type::F64).0;
                return (
                    self.unary(Unary::FloatToHalfBits, ty, float),
                    Class::Loose(ty),
                );
            }
            9 if ty == Type::I32 => {
                let (cond, a, b) = (
                    self.random.pick(&FloatCond::ALL),
                    self.promoted(),
                    self.promoted(),
                );
                self.float_compare(cond, a, b)
            }
            _ => {
                let float = self.float(from).0;
                self.unary(Unary::FloatToIntSaturating(sign), ty, float)
            }
        };
        (value, Class::Data(ty))
    }

    /// Whether the float is outside the range in which its conversion is determined.
    pub(super) fn does_not_fit_in_i32(&mut self, value: Value) -> Value {
        let ty = self.type_of(value);
        let (least, end) = (
            self.float_number(ty, -2_147_483_648.0),
            self.float_number(ty, 2_147_483_648.0),
        );
        let is_below = self.float_compare(FloatCond::LtOrUnordered, value, least);
        let is_above = self.float_compare(FloatCond::Ge, value, end);
        self.commutative(Binary::Or, is_below, is_above)
    }
}
