//! Small trees of few operations over few values and related constants, in which coincidences are likely.

use bun_engine_asm::{
    Cond, FloatCond, FloatWidth, Rounding, Sign, Size, VectorBinary, VectorReduce, VectorShift,
    VectorTernary, VectorUnary, lanes,
};
use bun_engine_codegen::ir::Binary::*;
use bun_engine_codegen::ir::Type::{F32, F64, I32, I64, V128};
use bun_engine_codegen::ir::{Binary, Checked, Lanes, Load, Op, Type, Unary, Value, Wide};

use super::integers::{SIGNS, width};
use super::templates::Node;
use super::{Class, Generator, constants};
use crate::support::datum::VectorOp;

#[derive(Clone, Copy)]
pub(super) enum Form {
    Int(Binary),
    Shift(Binary),
    Partial(Binary),
    IntUnary(Unary),
    Not,
    PowerOfTwo,
    Convert(Sign),
    Narrow,
    Compare(Cond),
    FloatCompare(FloatCond),
    Select,
    Checked(Checked),
    Load,
    LoadAs(Load),
    Wide(Wide, u32),
    MulWide(Sign, u32),
    Bitcast,
    Float(Binary),
    FloatBits(Binary),
    FloatUnary(Unary),
    ChangeWidth,
    ToFloat(Sign),
    ToInt(Sign),
    ToIntIfFits(Sign),
    FromHalf,
    VectorUnary(VectorUnary),
    VectorBinary(VectorBinary),
    VectorShift(VectorShift),
    Bitselect,
    Shuffle,
    Interleave,
    Splat,
    ReplaceLane,
    ExtractLane(Sign),
    Reduce(VectorReduce),
}

impl Form {
    pub(super) fn gives(self, ty: Type) -> bool {
        match self {
            Self::LoadAs(kind) => {
                ty == if let Load::Narrow(..) = kind {
                    I32
                } else {
                    V128
                } || kind == Load::Full
            }
            Self::Wide(..) | Self::MulWide(..) => ty == I64,
            Self::FromHalf => ty == F64,
            Self::Select | Self::Load => true,
            Self::Bitcast | Self::ExtractLane(_) => ty != V128,
            Self::Float(_) | Self::FloatBits(_) | Self::ChangeWidth | Self::ToFloat(_) => {
                ty.is_float()
            }
            Self::FloatUnary(op) => ty == F64 || ty == F32 && op != Unary::CanonicalizeNan,
            Self::VectorUnary(_)
            | Self::VectorBinary(_)
            | Self::VectorShift(_)
            | Self::Bitselect
            | Self::Shuffle
            | Self::Interleave
            | Self::Splat
            | Self::ReplaceLane => ty == V128,
            Self::Compare(_) | Self::FloatCompare(_) | Self::Reduce(_) => ty == I32,
            _ => ty.is_int(),
        }
    }
}

pub(super) struct Theme {
    forms: Vec<Form>,
    leaves: Vec<Value>,
    pub(super) named: Vec<(&'static str, Value)>,
    /// The positions in the scope of the values that have names.
    pub(super) taken: Vec<usize>,
    pub(super) numbers: [i64; 3],
    pub(super) amount: i64,
    constant_percent: u32,
    pub(super) compared: Type,
    pub(super) float: Type,
    pub(super) lanes: Size,
}

pub(super) type Made = (Value, Class);

/// Where an operand comes from.
#[derive(Clone, Copy)]
pub(super) enum Part {
    /// A tree of up to this height.
    Tree(i64),
    Template(&'static Node),
}

const FAMILIES: usize = 12;

impl Generator<'_> {
    fn vector_op<T: VectorOp>(&mut self, all: &[T], lanes: Size) -> T {
        let candidates = [(); 6].map(|()| self.random.pick(all));
        let fitting = candidates.into_iter().find(|op| op.lanes_read().0 == lanes);
        fitting.unwrap_or(candidates[0])
    }

    fn form(&mut self, family: usize, lanes: Size) -> Form {
        use Form::*;
        let (sign, cond) = (self.random.pick(&SIGNS), self.random.pick(&Cond::ALL));
        let float_cond = self.random.pick(&FloatCond::ALL);
        let size = self.random.pick(&[Size::S8, Size::S16]);
        let swapped = self.random.pick(&[Size::S16, Size::S32, Size::S64]);
        let bitwise = self.random.pick(&[And, Or, Xor]);
        let shift = self
            .random
            .pick(&[Shl, Shl, Shr, Shr, Sar, Sar, RotateLeft, RotateRight]);
        let checked =
            self.random
                .pick(&[self::Checked::Add, self::Checked::Sub, self::Checked::Mul]);
        let count = [
            Unary::CountLeadingZeros,
            Unary::CountTrailingZeros,
            Unary::CountOnes,
        ];
        let count = IntUnary(self.random.pick(&count));
        let (neg, extend) = (IntUnary(Unary::Neg), IntUnary(Unary::SignExtend(size)));
        let rounding = [
            Rounding::Down,
            Rounding::Up,
            Rounding::TowardZero,
            Rounding::Nearest,
        ];
        let round = FloatUnary(Unary::Round(self.random.pick(&rounding)));
        let equality = self.random.pick(&[Cond::Eq, Cond::Ne]);
        let unary = VectorUnary(self.vector_op(self::VectorUnary::ALL, lanes));
        let binary = VectorBinary(self.vector_op(self::VectorBinary::ALL, lanes));
        let vector_shift =
            VectorShift(self::VectorShift::ALL[3 * lanes as usize + self.random.below(3)]);
        let reduce = Reduce(self.vector_op(VectorReduce::ALL, lanes));
        let float_unary = [
            Unary::Neg,
            Unary::Neg,
            Unary::Abs,
            Unary::Sqrt,
            Unary::CanonicalizeNan,
        ];
        let float_unary = FloatUnary(self.random.pick(&float_unary));
        let float = Float(self.random.pick(&[Add, Sub, Mul, Div, Min, Max, CopySign]));
        let vector_bitwise = {
            use self::VectorBinary::{And, AndNot, Or, Xor};
            VectorBinary(self.random.pick(&[And, AndNot, Or, Xor]))
        };
        let vector_not = VectorUnary(self::VectorUnary::Not);
        let forms: &[Form] = match family {
            0 => &[
                Int(Add),
                Int(Sub),
                Int(Mul),
                neg,
                Not,
                Shift(Shl),
                Int(bitwise),
            ],
            1 => &[
                Int(And),
                Int(Or),
                Int(Xor),
                Not,
                Shift(shift),
                Convert(sign),
                extend,
                neg,
            ],
            2 => &[
                Shift(shift),
                Shift(shift),
                Int(bitwise),
                extend,
                Convert(sign),
                Form::Load,
                Int(Add),
                Int(Mul),
                Narrow,
            ],
            3 => &[
                Compare(cond),
                Compare(equality),
                Int(bitwise),
                Int(Add),
                Int(Sub),
                Narrow,
                Convert(sign),
                Not,
            ],
            4 => &[
                Compare(cond),
                Compare(equality),
                Shift(shift),
                count,
                neg,
                Int(Mul),
                IntUnary(Unary::SwapBytes(swapped)),
                Int(bitwise),
            ],
            5 => &[
                Partial(self.random.pick(&[Div, Rem, UnsignedDiv, UnsignedRem])),
                Int(self.random.pick(&[TotalDiv, TotalRem, MulHigh(sign)])),
                Int(Mul),
                Int(Sub),
                Narrow,
                PowerOfTwo,
                Compare(cond),
                Convert(sign),
            ],
            6 => &[
                Select,
                Select,
                Compare(cond),
                Int(bitwise),
                Int(Add),
                Shift(shift),
                Convert(sign),
                Checked(checked),
                Narrow,
            ],
            7 => &[
                float,
                float,
                float_unary,
                float_unary,
                round,
                FloatBits(bitwise),
                FloatCompare(float_cond),
                Select,
                Int(bitwise),
            ],
            8 => &[
                ToFloat(sign),
                ToInt(sign),
                ChangeWidth,
                Bitcast,
                Narrow,
                Convert(sign),
                float,
                round,
                float_unary,
                FloatCompare(float_cond),
                Int(bitwise),
                Form::Load,
            ],
            9 => &[
                vector_bitwise,
                vector_bitwise,
                vector_not,
                Bitselect,
                binary,
                vector_shift,
            ],
            10 => &[
                unary,
                unary,
                binary,
                binary,
                vector_shift,
                Shuffle,
                reduce,
                Compare(equality),
                Form::Load,
            ],
            _ => &[
                Shuffle,
                Splat,
                ReplaceLane,
                ExtractLane(sign),
                Form::Load,
                Bitcast,
                extend,
                Int(And),
                vector_shift,
            ],
        };
        self.random.pick(forms)
    }

    pub(super) fn themed(&mut self, ty: Type) -> Made {
        let weights = self.shape.weights;
        let families = [
            (true, 0..7),
            (weights.floats != 0, 7..9),
            (weights.vectors != 0, 9..FAMILIES),
        ];
        let families: Vec<usize> = families
            .into_iter()
            .filter(|(on, _)| *on)
            .flat_map(|(_, range)| range)
            .collect();
        let lanes = self
            .random
            .pick(&[Size::S8, Size::S16, Size::S32, Size::S64]);
        let forms = loop {
            let family = self.random.pick(&families);
            let mut forms: Vec<Form> = (0..self.random.between(2, 4))
                .map(|_| self.form(family, lanes))
                .collect();
            if self.random.one_in(4) {
                let other = self.random.pick(&families);
                forms.push(self.form(other, lanes));
            }
            forms.retain(|form| weights.accesses != 0 || !matches!(form, Form::Load));
            forms.retain(|form| weights.checks != 0 || !matches!(form, Form::Checked(_)));
            if forms.iter().any(|form| form.gives(ty)) {
                break forms;
            }
        };
        let mut theme = self.theme(ty, forms, lanes);
        let height = self.random.between(2, 4);
        self.grow(&mut theme, ty, Part::Tree(height))
    }

    pub(super) fn grow(&mut self, theme: &mut Theme, ty: Type, root: Part) -> Made {
        let depth = std::mem::replace(&mut self.depth, self.shape.expression_depth);
        let made = self.tree(theme, ty, root);
        self.depth = depth;
        made
    }

    pub(super) fn theme(&mut self, ty: Type, forms: Vec<Form>, lanes: Size) -> Theme {
        let compared = if ty.is_int() && self.random.flip() {
            ty
        } else {
            self.int_type()
        };
        let (number, amount) = (self.number(compared), self.constant_amount(compared));
        let edge = 1i64 << (width(compared) - 1);
        let related = [
            number.wrapping_neg(),
            !number,
            number.wrapping_add(1),
            number << amount,
            1 << amount,
            -1 << amount,
            !(-1 << amount),
            edge,
            0,
            0,
            1,
            -1,
        ];
        let theme = Theme {
            forms,
            leaves: Vec::new(),
            named: Vec::new(),
            taken: Vec::new(),
            numbers: [
                number,
                self.random.pick(&related),
                self.random.pick(&related),
            ],
            amount,
            constant_percent: self.random.pick(&[10, 30, 50]),
            compared,
            float: if ty.is_float() { ty } else { self.float_type() },
            lanes,
        };
        self.remarkable.extend(theme.numbers);
        theme
    }

    pub(super) fn leaf(&mut self, theme: &mut Theme, ty: Type) -> Made {
        let is_constant = self.random.percent(theme.constant_percent);
        let value = match ty {
            I32 | I64 if is_constant => {
                let number = self.random.pick(&theme.numbers);
                self.constant(ty, number)
            }
            V128 if is_constant => {
                let (number, any) = (
                    self.random.pick(&theme.numbers),
                    constants::vector(&mut self.random),
                );
                let bits = self.random.pick(&[
                    0,
                    u128::MAX,
                    lanes::splat(theme.lanes, number as u64),
                    any,
                ]);
                self.function.const_v128(bits)
            }
            _ if is_constant => {
                let bits = constants::float(ty, &mut self.random);
                self.function.constant(ty, bits)
            }
            _ => {
                let known: Vec<Value> = theme
                    .leaves
                    .iter()
                    .copied()
                    .filter(|&leaf| self.type_of(leaf) == ty)
                    .collect();
                if known.len() >= 3 || !known.is_empty() && self.random.percent(55) {
                    self.random.pick(&known)
                } else {
                    let new = if ty.is_int() {
                        self.known_int(ty)
                    } else {
                        self.data(ty)
                    };
                    theme.leaves.push(new);
                    new
                }
            }
        };
        (value, Class::Data(ty))
    }

    fn exact(&mut self, theme: &mut Theme, ty: Type, part: Part) -> Value {
        let (value, class) = self.tree(theme, ty, part);
        self.settle(value, class)
    }

    fn lanes_of(&mut self, theme: &mut Theme, read: Option<FloatWidth>, part: Part) -> Made {
        let (value, class) = self.tree(theme, V128, part);
        if read.map(Class::LooseLanes) == Some(class) {
            (value, class)
        } else {
            (self.settle(value, class), Class::Data(V128))
        }
    }

    fn theme_lanes(&mut self, theme: &Theme) -> Lanes {
        match theme.lanes {
            Size::S32 if self.random.flip() => Lanes::Float(FloatWidth::F32),
            Size::S64 if self.random.flip() => Lanes::Float(FloatWidth::F64),
            size => Lanes::Int(size),
        }
    }

    fn theme_amount(&mut self, theme: &mut Theme, bits: i64, part: Part) -> Value {
        let Part::Tree(height) = part else {
            let outer = std::mem::replace(&mut theme.compared, if bits == 64 { I64 } else { I32 });
            let amount = self.exact(theme, I32, part);
            theme.compared = outer;
            return amount;
        };
        match self.random.below(8) {
            0 | 1 => self.exact(theme, I32, Part::Tree(height.min(1))),
            2 | 3 => self.constant(I32, bits - theme.amount % bits),
            4 => {
                let amount = self.random.pick(&[1, 8, 16, bits / 2, bits - 1, bits - 8]);
                self.constant(I32, amount)
            }
            _ => self.constant(I32, theme.amount % bits),
        }
    }

    fn tree(&mut self, theme: &mut Theme, ty: Type, part: Part) -> Made {
        let made = match part {
            Part::Template(node) => self.instantiate(theme, ty, node),
            Part::Tree(height) => {
                let forms = theme.forms.iter().copied();
                let forms: Vec<Form> = forms.filter(|form| form.gives(ty)).collect();
                if height == 0 || forms.is_empty() {
                    return self.leaf(theme, ty);
                }
                let form = self.random.pick(&forms);
                let below = |()| Part::Tree(if self.random.one_in(3) { 0 } else { height - 1 });
                let parts = [(); 4].map(below);
                self.apply(theme, form, ty, parts)
            }
        };
        if self.random.one_in(12) {
            self.keep(made.0, made.1);
            if made.1.has_determined_bits() {
                theme.leaves.push(made.0);
            }
        }
        made
    }

    pub(super) fn apply(
        &mut self,
        theme: &mut Theme,
        form: Form,
        ty: Type,
        [a, b, c, d]: [Part; 4],
    ) -> Made {
        let (data, loose) = (Class::Data(ty), Class::Loose(ty));
        let of_lanes = |width: Option<FloatWidth>| width.map_or(data, Class::LooseLanes);
        let value = match form {
            Form::Int(op) | Form::FloatBits(op) => {
                let (x, y) = (self.exact(theme, ty, a), self.exact(theme, ty, b));
                self.binary(op, x, y)
            }
            Form::Shift(op) => {
                let (x, amount) = (
                    self.exact(theme, ty, a),
                    self.theme_amount(theme, width(ty), b),
                );
                self.binary(op, x, amount)
            }
            Form::Partial(op) => {
                let x = self.exact(theme, ty, a);
                let divisor = match b {
                    Part::Tree(_) => self.value_of(Class::Divisor(ty)),
                    Part::Template(node) => self.instantiate_divisor(theme, ty, node),
                };
                theme.leaves.push(divisor);
                self.binary(op, x, divisor)
            }
            Form::IntUnary(op) => {
                let x = self.exact(theme, ty, a);
                let op = if let Unary::SwapBytes(size) = op {
                    Unary::SwapBytes(size.min(ty.width().size()))
                } else {
                    op
                };
                self.unary(op, ty, x)
            }
            Form::Not => {
                let x = self.exact(theme, ty, a);
                self.binary_constant(Xor, x, -1)
            }
            Form::PowerOfTwo => {
                let (one, amount) = (self.constant(ty, 1), self.exact(theme, I32, Part::Tree(0)));
                self.binary(Shl, one, amount)
            }
            Form::Convert(sign) => {
                let (op, from) = if ty == I32 {
                    (Unary::Wrap, I64)
                } else {
                    (Unary::Widen(sign), I32)
                };
                let x = self.exact(theme, from, a);
                self.unary(op, ty, x)
            }
            Form::Narrow => {
                let x = self.exact(theme, ty, a);
                self.narrowed(x)
            }
            Form::Compare(cond) => {
                let compared = theme.compared;
                let (x, y) = (
                    self.exact(theme, compared, a),
                    self.exact(theme, compared, b),
                );
                self.compare(cond, x, y)
            }
            Form::FloatCompare(cond) => {
                let compared = theme.float;
                let (x, y) = (
                    self.tree(theme, compared, a).0,
                    self.tree(theme, compared, b).0,
                );
                self.float_compare(cond, x, y)
            }
            Form::Select => {
                let tested = if self.random.one_in(4) {
                    theme.compared
                } else {
                    I32
                };
                let (condition, x, y) = (
                    self.exact(theme, tested, a),
                    self.exact(theme, ty, b),
                    self.exact(theme, ty, c),
                );
                self.select(condition, x, y)
            }
            Form::Checked(op) => {
                let (x, y) = (self.exact(theme, ty, a), self.exact(theme, ty, b));
                self.checked(op, x, y)
            }
            Form::Load => self.load(ty),
            Form::LoadAs(kind) => self.load_as(kind, ty),
            Form::Wide(op, position) => {
                let args = [a, b, c, d].map(|part| self.exact(theme, ty, part));
                let tuple = self.emit(Op::Wide(op, args), Type::Tuple);
                self.extract_half(tuple, position)
            }
            Form::MulWide(sign, position) => {
                let args = [a, b].map(|part| self.exact(theme, ty, part));
                let tuple = self.emit(Op::MulWide(sign, args), Type::Tuple);
                self.extract_half(tuple, position)
            }
            Form::ToIntIfFits(sign) => {
                let x = self.tree(theme, theme.float, a).0;
                return (self.unary(Unary::FloatToInt(sign), ty, x), loose);
            }
            Form::FromHalf if self.target.has_half_floats() => {
                let x = self.exact(theme, I32, a);
                return (self.unary(Unary::HalfBitsToFloat, ty, x), loose);
            }
            Form::FromHalf => return self.leaf(theme, ty),
            Form::Interleave => {
                let (x, y) = (self.exact(theme, ty, a), self.exact(theme, ty, b));
                let (unit, first) = ((theme.lanes.bytes() / 2).max(1), self.random.pick(&[0, 8]));
                let pattern = std::array::from_fn(|index| {
                    let index = index as u8;
                    first + index / unit % 2 * 16 + index / (2 * unit) * unit + index % unit
                });
                self.builder().shuffle(x, y, pattern)
            }
            Form::Bitcast => {
                let from = match ty {
                    I32 => F32,
                    I64 => F64,
                    _ => ty.width().into(),
                };
                let x = self.exact(theme, from, a);
                self.unary(Unary::Bitcast, ty, x)
            }
            Form::Float(CopySign) => {
                let ((x, class), y) = (self.tree(theme, ty, a), self.exact(theme, ty, b));
                return (self.binary(CopySign, x, y), class);
            }
            Form::Float(op) => {
                let (x, y) = (self.tree(theme, ty, a).0, self.tree(theme, ty, b).0);
                return (self.binary(op, x, y), loose);
            }
            Form::FloatUnary(op) => {
                let (x, class) = self.tree(theme, ty, a);
                let class = match op {
                    Unary::Neg | Unary::Abs => class,
                    Unary::CanonicalizeNan => data,
                    _ => loose,
                };
                return (self.unary(op, ty, x), class);
            }
            Form::ChangeWidth => {
                let (op, from) = if ty == F32 {
                    (Unary::Demote, F64)
                } else {
                    (Unary::Promote, F32)
                };
                let x = self.tree(theme, from, a).0;
                return (self.unary(op, ty, x), loose);
            }
            Form::ToFloat(sign) => {
                let x = self.exact(theme, theme.compared, a);
                self.unary(Unary::IntToFloat(sign), ty, x)
            }
            Form::ToInt(sign) => {
                let is_modular =
                    ty == I32 && self.target.has_float_to_int32_modular() && self.random.one_in(3);
                let (op, from) = if is_modular {
                    (Unary::FloatToInt32Modular, F64)
                } else {
                    (Unary::FloatToIntSaturating(sign), theme.float)
                };
                let x = self.tree(theme, from, a).0;
                self.unary(op, ty, x)
            }
            Form::VectorUnary(op) => {
                use self::VectorUnary::{F32x4Abs, F32x4Neg, F64x2Abs, F64x2Neg};
                let (x, class) =
                    self.lanes_of(theme, op.lanes_read().1.filter(|_| !op.is_relaxed()), a);
                let keeps_bits = matches!(op, F32x4Abs | F32x4Neg | F64x2Abs | F64x2Neg);
                let class = if keeps_bits {
                    class
                } else {
                    of_lanes(op.nan_lanes())
                };
                return (self.emit(Op::VectorUnary(op, x), ty), class);
            }
            Form::VectorBinary(op) => {
                let read = op.lanes_read().1;
                let args = [
                    self.lanes_of(theme, read, a).0,
                    self.lanes_of(theme, read, b).0,
                ];
                let class = of_lanes(read.filter(|_| op.mask_lanes().is_none()));
                return (self.emit(Op::VectorBinary(op, args), ty), class);
            }
            Form::VectorShift(op) => {
                let (x, amount) = (
                    self.exact(theme, ty, a),
                    self.theme_amount(theme, op.lanes().bits().into(), b),
                );
                self.emit(Op::VectorShift(op, [x, amount]), ty)
            }
            Form::Bitselect => {
                let args = [a, b, c].map(|part| self.exact(theme, ty, part));
                self.emit(Op::VectorTernary(VectorTernary::Bitselect, args), ty)
            }
            Form::Shuffle => {
                let (x, y, pattern) = (
                    self.exact(theme, ty, a),
                    self.exact(theme, ty, b),
                    self.shuffle_pattern(),
                );
                self.builder().shuffle(x, y, pattern)
            }
            Form::Splat => {
                let lanes = self.theme_lanes(theme);
                let scalar = self.exact(theme, lanes.scalar(), a);
                self.builder().splat(lanes, scalar)
            }
            Form::ReplaceLane => {
                let lanes = self.theme_lanes(theme);
                let (x, scalar) = (
                    self.exact(theme, ty, a),
                    self.exact(theme, lanes.scalar(), b),
                );
                let lane = self.lane(lanes);
                self.builder().replace_lane(lanes, x, lane, scalar)
            }
            Form::ExtractLane(sign) => {
                let lanes = match ty {
                    I32 => Lanes::Int(theme.lanes.min(Size::S32)),
                    I64 => Lanes::Int(Size::S64),
                    _ => Lanes::Float(ty.float_width()),
                };
                let (x, lane) = (self.exact(theme, V128, a), self.lane(lanes));
                self.builder().extract_lane(lanes, sign, x, lane)
            }
            Form::Reduce(op) => {
                let x = self.exact(theme, V128, a);
                self.emit(Op::VectorReduce(op, x), ty)
            }
        };
        (value, data)
    }
}
