//! Expressions in the shape that a rule looks for, and near misses.
//!
//! A line of `templates.txt` has the type of the result and an expression. `|` separates alternatives.
//!
//! - `x`, `y`, `z` and `w` are values of the type that the place wants, and `dv` is one by which to divide.
//! - `c` and `d` are related numbers, `k` and `j` amounts to shift by, and `W` the width. `odd` is `c` made odd.
//! - `@Name` is the vector operation with this name after that of the lanes, and `*` stands for any text.

use std::sync::OnceLock;

use bun_engine_asm::Sign::{Signed, Unsigned};
use bun_engine_asm::Size::{S8, S16, S32, S64};
use bun_engine_asm::{
    Cond, FloatCond, Rounding, Size, VectorBinary, VectorReduce, VectorShift, VectorUnary, lanes,
};
use bun_engine_codegen::ir::Binary::*;
use bun_engine_codegen::ir::Type::{F32, F64, I32, I64, V128};
use bun_engine_codegen::ir::{Checked, Load, Op, Type, Unary, Value, Wide};

use super::integers::{SIGNS, width};
use super::themes::{Form, Made, Part, Theme};
use super::{Class, Generator, constants};
use crate::support::vocabulary::{NOT_CELL_MASK, NUMBER_TAG};

pub(super) struct Node {
    alternatives: Vec<&'static str>,
    /// `None` for what is not in parentheses.
    operands: Option<Vec<Node>>,
}

fn parse(tokens: &mut impl Iterator<Item = &'static str>) -> Option<Node> {
    let first = tokens.next().filter(|&token| token != ")")?;
    let is_list = first == "(";
    let name = if is_list { tokens.next()? } else { first };
    Some(Node {
        alternatives: name.split('|').collect(),
        operands: is_list.then(|| std::iter::from_fn(|| parse(tokens)).collect()),
    })
}

fn templates() -> &'static [(Node, Node)] {
    static PARSED: OnceLock<Vec<(Node, Node)>> = OnceLock::new();
    PARSED.get_or_init(|| {
        let text = include_str!("templates.txt")
            .replace('(', " ( ")
            .replace(')', " ) ");
        let lines = text
            .leak()
            .lines()
            .filter(|line| !line.is_empty() && !line.starts_with('#'));
        let parse_line = |line: &'static str| {
            let mut tokens = line.split_whitespace();
            (parse(&mut tokens).unwrap(), parse(&mut tokens).unwrap())
        };
        lines.map(parse_line).collect()
    })
}

fn vector_forms() -> &'static [(String, Form)] {
    static NAMED: OnceLock<Vec<(String, Form)>> = OnceLock::new();
    fn named<T: Copy + std::fmt::Debug>(
        all: &[T],
        form: fn(T) -> Form,
    ) -> impl Iterator<Item = (String, Form)> {
        all.iter().map(move |&op| (format!("{op:?}"), form(op)))
    }
    NAMED.get_or_init(|| {
        named(VectorUnary::ALL, Form::VectorUnary)
            .chain(named(VectorBinary::ALL, Form::VectorBinary))
            .chain(named(VectorShift::ALL, Form::VectorShift))
            .chain(named(VectorReduce::ALL, Form::Reduce))
            .collect()
    })
}

/// What can stand in for each other.
const KINDRED: [&[&str]; 16] = [
    &["add", "sub", "mul", "and", "or", "xor"],
    &["shl", "shr", "sar", "rotl", "rotr"],
    &["div", "rem", "udiv", "urem"],
    &["tdiv", "trem", "mulh", "umulh"],
    &["neg", "not", "sext8", "sext16", "bswap"],
    &["clz", "ctz", "popcnt"],
    &["sx", "zx"],
    &[
        "eq", "ne", "lt", "ge", "le", "gt", "below", "aboveeq", "beloweq", "above",
    ],
    &["cadd", "csub", "cmul"],
    &["load8s", "load8u", "load16s", "load16u", "load"],
    &["fadd", "fsub", "fmul", "fdiv", "fmin", "fmax", "copysign"],
    &["fneg", "fabs", "round", "sqrt"],
    &["itof", "utof"],
    &["ordered", "unordered", "feq", "fcmp"],
    &["vand", "vandnot", "vor", "vxor"],
    &["x", "y", "z"],
];

impl Generator<'_> {
    pub(super) fn template_statement(&mut self) {
        let (kind, root) = &templates()[self.random.below(templates().len())];
        let kind = self.random.pick(&kind.alternatives);
        let (int, float) = (self.int_type(), self.float_type());
        let ty = match kind {
            "int" => int,
            "i32" | "bool" | "bool32" | "bool64" => I32,
            "i64" => I64,
            "float" => float,
            "f32" => F32,
            "f64" => F64,
            _ => V128,
        };
        let lanes = match kind {
            "w8" => S8,
            "w16" => S16,
            "w32" => S32,
            "w64" => S64,
            _ => self.random.pick(&[S8, S16, S32, S64]),
        };
        let mut theme = self.theme(ty, Vec::new(), lanes);
        theme.compared = match kind {
            "bool32" => I32,
            "bool64" => I64,
            "int" | "i32" | "i64" => ty,
            _ => int,
        };
        let (value, class) = self.grow(&mut theme, ty, Part::Template(root));
        match self.random.below(16) {
            0 | 1 if class.has_determined_bits() && self.shape.weights.accesses != 0 => {
                self.store_somewhere(value)
            }
            2 | 3 if ty.is_int() && class.has_determined_bits() => {
                self.scope.conditions.push(value)
            }
            4..8 if ty.is_int() && class.has_determined_bits() => self.use_as_condition(value),
            _ => {
                self.keep(value, class);
            }
        }
    }

    /// At once, and mostly in one place.
    pub(super) fn use_as_condition(&mut self, condition: Value) {
        for _ in 0..self.random.pick(&[1, 1, 1, 2]) {
            match self.random.below(16) {
                0..6 => {
                    self.witness(condition);
                }
                6 => {
                    let sometimes = self.condition();
                    self.perhaps(sometimes, &[], &mut |this| {
                        this.check(condition);
                        Vec::new()
                    });
                }
                7..10 => {
                    let cond = self.random.pick(&[Cond::Eq, Cond::Ne]);
                    let boolean = self.compare_constant(cond, condition, 0);
                    self.keep(boolean, Class::BOOLEAN);
                }
                _ => {
                    let ty = self.data_type();
                    let (then, or) = (self.data(ty), self.data(ty));
                    let chosen = self.select(condition, then, or);
                    self.keep(chosen, Class::Data(ty));
                }
            }
        }
    }

    fn form_named(&mut self, theme: &Theme, name: &str) -> Option<Form> {
        use Form::{
            Compare, Float, FloatBits, FloatCompare, FloatUnary, Int, IntUnary, Partial, Shift,
        };
        let sign = self.random.pick(&SIGNS);
        let rounding = [
            Rounding::Down,
            Rounding::Up,
            Rounding::TowardZero,
            Rounding::Nearest,
        ];
        if let Some(pattern) = name.strip_prefix('@') {
            let shape = format!("{}x{}", theme.lanes.bits(), lanes::count(theme.lanes));
            let (start, end) = pattern
                .split_once('*')
                .map_or((pattern, None), |(start, end)| (start, Some(end)));
            let fits = |&(known, _): &&(String, Form)| {
                known[1..]
                    .strip_prefix(&shape)
                    .and_then(|rest| rest.strip_prefix(start))
                    .is_some_and(|rest| end.map_or(rest.is_empty(), |end| rest.ends_with(end)))
            };
            let found: Vec<Form> = vector_forms()
                .iter()
                .filter(fits)
                .map(|&(_, form)| form)
                .collect();
            return (!found.is_empty()).then(|| self.random.pick(&found));
        }
        Some(match name {
            "add" => Int(Add),
            "sub" => Int(Sub),
            "mul" => Int(Mul),
            "and" => Int(And),
            "or" => Int(Or),
            "xor" => Int(Xor),
            "tdiv" => Int(TotalDiv),
            "trem" => Int(TotalRem),
            "mulh" => Int(MulHigh(Signed)),
            "umulh" => Int(MulHigh(Unsigned)),
            "shl" => Shift(Shl),
            "shr" => Shift(Shr),
            "sar" => Shift(Sar),
            "rotl" => Shift(RotateLeft),
            "rotr" => Shift(RotateRight),
            "div" => Partial(Div),
            "rem" => Partial(Rem),
            "udiv" => Partial(UnsignedDiv),
            "urem" => Partial(UnsignedRem),
            "neg" => IntUnary(Unary::Neg),
            "not" => Form::Not,
            "clz" => IntUnary(Unary::CountLeadingZeros),
            "ctz" => IntUnary(Unary::CountTrailingZeros),
            "popcnt" => IntUnary(Unary::CountOnes),
            "bswap" => IntUnary(Unary::SwapBytes(S64)),
            "bswap16" => IntUnary(Unary::SwapBytes(S16)),
            "bswap32" => IntUnary(Unary::SwapBytes(S32)),
            "sext8" => IntUnary(Unary::SignExtend(S8)),
            "sext16" => IntUnary(Unary::SignExtend(S16)),
            "opaque" => IntUnary(Unary::Opaque),
            "sx" => Form::Convert(Signed),
            "zx" | "wrap" => Form::Convert(Unsigned),
            "narrow" => Form::Narrow,
            "cmp" => Compare(self.random.pick(&Cond::ALL)),
            "eq" => Compare(Cond::Eq),
            "ne" => Compare(Cond::Ne),
            "lt" => Compare(Cond::Lt),
            "ge" => Compare(Cond::Ge),
            "le" => Compare(Cond::Le),
            "gt" => Compare(Cond::Gt),
            "below" => Compare(Cond::Below),
            "aboveeq" => Compare(Cond::AboveEq),
            "beloweq" => Compare(Cond::BelowEq),
            "above" => Compare(Cond::Above),
            "select" => Form::Select,
            "cadd" => Form::Checked(Checked::Add),
            "csub" => Form::Checked(Checked::Sub),
            "cmul" => Form::Checked(Checked::Mul),
            "load" => Form::LoadAs(Load::Full),
            "load8s" => Form::LoadAs(Load::Narrow(S8, Signed)),
            "load8u" => Form::LoadAs(Load::Narrow(S8, Unsigned)),
            "load16s" => Form::LoadAs(Load::Narrow(S16, Signed)),
            "load16u" => Form::LoadAs(Load::Narrow(S16, Unsigned)),
            "loadzero64" => Form::LoadAs(Load::VectorZero(S64)),
            "wadd0" => Form::Wide(Wide::Add, 0),
            "wadd1" => Form::Wide(Wide::Add, 1),
            "wsub0" => Form::Wide(Wide::Sub, 0),
            "wsub1" => Form::Wide(Wide::Sub, 1),
            "wmul0" => Form::MulWide(sign, 0),
            "wmul1" => Form::MulWide(sign, 1),
            "bitcast" => Form::Bitcast,
            "fadd" => Float(Add),
            "fsub" => Float(Sub),
            "fmul" => Float(Mul),
            "fdiv" => Float(Div),
            "fmin" => Float(Min),
            "fmax" => Float(Max),
            "copysign" => Float(CopySign),
            "fand" => FloatBits(And),
            "for" => FloatBits(Or),
            "fxor" => FloatBits(Xor),
            "fneg" => FloatUnary(Unary::Neg),
            "fabs" => FloatUnary(Unary::Abs),
            "sqrt" => FloatUnary(Unary::Sqrt),
            "round" => FloatUnary(Unary::Round(self.random.pick(&rounding))),
            "trunc" => FloatUnary(Unary::Round(Rounding::TowardZero)),
            "canon" => FloatUnary(Unary::CanonicalizeNan),
            "resize" => Form::ChangeWidth,
            "itof" => Form::ToFloat(Signed),
            "utof" => Form::ToFloat(Unsigned),
            "ftoi" => Form::ToInt(sign),
            "ftoi?" => Form::ToIntIfFits(sign),
            "h2f" => Form::FromHalf,
            "fcmp" => FloatCompare(self.random.pick(&FloatCond::ALL)),
            "feq" => FloatCompare(FloatCond::Eq),
            "ordered" => FloatCompare(FloatCond::Ordered),
            "unordered" => FloatCompare(FloatCond::Unordered),
            "vnot" => Form::VectorUnary(VectorUnary::Not),
            "vand" => Form::VectorBinary(VectorBinary::And),
            "vandnot" => Form::VectorBinary(VectorBinary::AndNot),
            "vor" => Form::VectorBinary(VectorBinary::Or),
            "vxor" => Form::VectorBinary(VectorBinary::Xor),
            "bitselect" => Form::Bitselect,
            "shuffle" => Form::Shuffle,
            "zip" => Form::Interleave,
            "splat" => Form::Splat,
            "replace" => Form::ReplaceLane,
            "extract" => Form::ExtractLane(sign),
            "anytrue" => Form::Reduce(VectorReduce::AnyTrue),
            _ => panic!("no operation is named {name}"),
        })
    }

    fn number_named(&mut self, theme: &Theme, ty: Type, name: &str) -> Option<i64> {
        let (bits, lane_bits) = (width(theme.compared), i64::from(theme.lanes.bits()));
        let ([c, d, _], k) = (theme.numbers, (theme.amount % bits).max(1));
        Some(match name {
            "c" => c,
            "d" => d,
            "-c" => c.wrapping_neg(),
            "~c" => !c,
            "odd" => c | 1,
            "tag" => NUMBER_TAG as i64,
            "-tag" => NUMBER_TAG.wrapping_neg() as i64,
            "notcell" => NOT_CELL_MASK as i64,
            "small" => self.random.between(-3, 40),
            "short" => self.random.between(0, 5),
            "imm" => {
                let edge = self.random.pick(&[31, 32, 4095, 4096, 0x5000, 0xff_f000]);
                (edge + self.random.between(-1, 1)) * self.random.pick(&[1, -1])
            }
            "~mask" => -1 << k,
            "gap" => !(0xff << (k % (bits - 8))),
            "gapat" => k % (bits - 8),
            "k" => k,
            "j" => self.constant_amount(theme.compared),
            "W" => bits,
            "W-1" => bits - 1,
            "W-8" => bits - 8,
            "W-16" => bits - 16,
            "W-k" => bits - k,
            "logW" => bits.ilog2().into(),
            "c<<k" => c << k,
            "small<<k" => self.random.between(-9, 9) << k,
            "1<<k" => 1 << k,
            "-1<<k" => -1 << k,
            "mask" => !(-1 << k),
            "2<<k-1" => !(-2 << k),
            "min" => -1 << (width(ty) - 1),
            "max" => !(-1 << (width(ty) - 1)),
            "lane/2" => lane_bits / 2,
            "lane-8" => lane_bits - 8,
            "lane-3" => lane_bits - 3,
            "lane-1" => lane_bits - 1,
            "all" => (1 << lanes::count(theme.lanes)) - 1,
            _ => match name.strip_prefix("0x") {
                Some(digits) => i64::from_str_radix(digits, 16).ok()?,
                None => name.parse().ok()?,
            },
        })
    }

    fn named_value(&mut self, theme: &mut Theme, name: &'static str, class: Class) -> Value {
        let mut named = theme.named.iter();
        if let Some(&(_, value)) =
            named.find(|&&(known, value)| known == name && self.type_of(value) == class.ty())
        {
            return value;
        }
        let found = (0..3).find_map(|_| {
            let found = self.find_position(|known| known.satisfies(class))?;
            (!theme.taken.contains(&found)).then_some(found)
        });
        theme.taken.extend(found);
        let found = found.map(|position| self.scope.values[position].value);
        let value = found.unwrap_or_else(|| match class {
            Class::Data(ty) if self.shape.weights.accesses != 0 => {
                let loaded = self.load_as(Load::Full, ty);
                self.learn(loaded, class);
                loaded
            }
            _ => self.value_of(class),
        });
        theme.named.push((name, value));
        value
    }

    fn atom(&mut self, theme: &mut Theme, ty: Type, name: &'static str) -> Value {
        let size_of = |ty: Type| -> Size { ty.width().size() };
        match (name, ty) {
            ("x" | "y" | "z" | "w", _) => self.named_value(theme, name, Class::Data(ty)),
            ("dv", _) => self.named_value(theme, name, Class::Divisor(ty)),
            ("bytes", _) => {
                let bytes = [(); 16].map(|()| self.random.pick(&[0, 0xff]));
                self.function.const_v128(u128::from_le_bytes(bytes))
            }
            ("any", V128) => {
                let bits = constants::vector(&mut self.random);
                self.function.const_v128(bits)
            }
            ("any", _) => {
                let bits = constants::float(ty, &mut self.random);
                self.function.constant(ty, bits)
            }
            ("x^y", _) => {
                let known = theme.named.iter().find(|known| known.0 == name).copied();
                known.map_or_else(
                    || {
                        let args = ["x", "y"].map(|name| self.atom(theme, ty, name));
                        let both = self.emit(Op::VectorBinary(VectorBinary::Xor, args), ty);
                        theme.named.push((name, both));
                        both
                    },
                    |(_, both)| both,
                )
            }
            ("ones16", _) => self.splat_constant(S16, 1),
            (_, V128) => {
                let number = self.number_named(theme, I64, name).unwrap();
                self.splat_constant(theme.lanes, number as u64)
            }
            ("sign" | "~sign" | "ones", _) => {
                let sign = 1u64 << (size_of(ty).bits() - 1);
                self.function.constant(
                    ty,
                    if name == "sign" {
                        sign
                    } else if name == "ones" {
                        u64::MAX
                    } else {
                        sign - 1
                    },
                )
            }
            (_, F32 | F64) => {
                let number = name
                    .parse()
                    .unwrap_or_else(|_| self.number_named(theme, I64, name).unwrap() as f64);
                if ty == F32 {
                    self.function.const_f32(number as f32)
                } else {
                    self.function.const_f64(number)
                }
            }
            _ => {
                let number = self.number_named(theme, ty, name).unwrap();
                let slip = if self.random.one_in(16) {
                    self.random.pick(&[-1, 1])
                } else {
                    0
                };
                self.remarkable.push(number);
                self.constant(ty, number.wrapping_add(slip))
            }
        }
    }

    pub(super) fn instantiate(&mut self, theme: &mut Theme, ty: Type, node: &'static Node) -> Made {
        let mut name = self.random.pick(&node.alternatives);
        if self.random.one_in(24)
            && let Some(kindred) = KINDRED.iter().find(|kindred| kindred.contains(&name))
        {
            name = self.random.pick(kindred);
        }
        let Some(operands) = &node.operands else {
            return (self.atom(theme, ty, name), Class::Data(ty));
        };
        let parts =
            std::array::from_fn(|index| operands.get(index).map_or(Part::Tree(0), Part::Template));
        let weights = self.shape.weights;
        match self.form_named(theme, name) {
            Some(Form::LoadAs(_)) if weights.accesses == 0 => self.leaf(theme, ty),
            Some(form) if form.gives(ty) => self.apply(theme, form, ty, parts),
            Some(form) if ty == I64 && form.gives(I32) => {
                let (narrow, class) = self.apply(theme, form, I32, parts);
                assert!(class.has_determined_bits());
                (
                    self.unary(Unary::Widen(Unsigned), ty, narrow),
                    Class::Data(ty),
                )
            }
            _ => self.leaf(theme, ty),
        }
    }

    pub(super) fn instantiate_divisor(
        &mut self,
        theme: &mut Theme,
        ty: Type,
        node: &'static Node,
    ) -> Value {
        match self.random.pick(&node.alternatives) {
            "dv" => self.atom(theme, ty, "dv"),
            "1<<y" => {
                let (one, amount) = (self.constant(ty, 1), self.atom(theme, I32, "y"));
                self.binary(Shl, one, amount)
            }
            name => {
                let number = self.number_named(theme, ty, name).unwrap();
                let divisor = self.constant(ty, number);
                let is_allowed = !matches!(self.function.int_constant(divisor), Some(0 | -1));
                if is_allowed {
                    divisor
                } else {
                    self.constant(ty, 3)
                }
            }
        }
    }
}
