//! Values of which some bits may be left open, and what operations make of them.

use std::fmt;
use std::sync::OnceLock;

use bun_engine_asm::{
    Cond, FloatCond, FloatWidth, Relaxed, Shift, Sign, Size, VectorBinary, VectorReduce,
    VectorShift, VectorTernary, VectorUnary, lanes,
};
use bun_engine_codegen::ir::{Binary, Checked, Type, Unary, Wide, evaluate};

use super::memory::Segment;
use super::random::Random;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Kind {
    Plain,
    /// Whatever the open bits are.
    Nan(FloatWidth),
    /// Derived from the address of a part of the frame, which machine code has elsewhere.
    FrameAddress(Segment),
    /// Differs from all others, and that is all.
    Identity,
}

/// A set of values: those that agree with `bits`, which is one of them, where `unknown` is clear.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct Datum {
    pub(crate) bits: u128,
    pub(crate) unknown: u128,
    pub(crate) kind: Kind,
}

/// What comes next depends on bits that are open.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct Open;

pub(crate) fn all_bits(ty: Type) -> u128 {
    u128::MAX >> (128 - 8 * ty.bytes())
}

struct Format {
    sign: u64,
    exponent: u64,
    quiet: u64,
}

impl Format {
    fn of(width: FloatWidth) -> Self {
        match width {
            FloatWidth::F32 => Self {
                sign: 1 << 31,
                exponent: 0xff << 23,
                quiet: 1 << 22,
            },
            FloatWidth::F64 => Self {
                sign: 1 << 63,
                exponent: 0x7ff << 52,
                quiet: 1 << 51,
            },
        }
    }

    fn fraction(&self) -> u64 {
        self.quiet * 2 - 1
    }

    fn is_nan(&self, bits: u64) -> bool {
        bits & self.exponent == self.exponent && bits & self.fraction() != 0
    }
}

pub(crate) fn is_nan(width: FloatWidth, bits: u64) -> bool {
    Format::of(width).is_nan(bits)
}

pub(crate) fn canonical_nan(width: FloatWidth) -> u64 {
    let format = Format::of(width);
    format.exponent | format.quiet
}

/// What arithmetic can tell of a float.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Reading {
    Number,
    CanonicalNan,
    OtherNan,
    Unknown,
}

fn read_float(width: FloatWidth, bits: u64, unknown: u64, is_marked: bool) -> Reading {
    let format = Format::of(width);
    if format.is_nan(bits & !unknown) || is_marked {
        let magnitude = format.exponent | format.fraction();
        if unknown & magnitude == 0 && bits & magnitude == canonical_nan(width) {
            Reading::CanonicalNan
        } else {
            Reading::OtherNan
        }
    } else if unknown == 0 {
        Reading::Number
    } else {
        Reading::Unknown
    }
}

/// The open bits of a NaN that arithmetic gives. Canonical operands give a canonical result, as in WebAssembly.
fn open_bits_of_nan(width: FloatWidth, operands: &[Reading], quiets: bool) -> u64 {
    let format = Format::of(width);
    if !operands.contains(&Reading::OtherNan) {
        format.sign
    } else if quiets {
        format.sign | format.fraction() & !format.quiet
    } else {
        format.sign | format.fraction()
    }
}

impl fmt::Debug for Datum {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:#x}", self.bits & !self.unknown)?;
        if self.unknown != 0 {
            write!(f, "?{:#x}", self.unknown)?;
        }
        match self.kind {
            Kind::Plain => Ok(()),
            kind => write!(f, " {kind:?}"),
        }
    }
}

impl From<u128> for Datum {
    fn from(bits: u128) -> Self {
        Self::new(bits, 0)
    }
}

impl From<u64> for Datum {
    fn from(bits: u64) -> Self {
        Self::new(bits.into(), 0)
    }
}

impl Datum {
    pub(crate) const fn new(bits: u128, unknown: u128) -> Self {
        Self {
            bits,
            unknown,
            kind: Kind::Plain,
        }
    }

    pub(crate) fn anything(ty: Type) -> Self {
        Self::new(0, all_bits(ty))
    }

    fn scalar(bits: u64, unknown: u64) -> Self {
        Self::new(bits.into(), unknown.into())
    }

    pub(crate) fn frame_address(segment: Segment, address: u64) -> Self {
        Self {
            kind: Kind::FrameAddress(segment),
            ..address.into()
        }
    }

    /// With the bits of a frame address left open.
    pub(crate) fn as_bits(self) -> Self {
        match self.kind {
            Kind::FrameAddress(_) | Kind::Identity => Self::new(self.bits, u64::MAX.into()),
            _ => self,
        }
    }

    pub(crate) fn is_known(self) -> bool {
        self.unknown == 0 && !matches!(self.kind, Kind::FrameAddress(_) | Kind::Identity)
    }

    pub(crate) fn known(self) -> Result<u64, Open> {
        if self.is_known() {
            Ok(self.bits as u64)
        } else {
            Err(Open)
        }
    }

    pub(crate) fn is_not_zero(self) -> Result<bool, Open> {
        let Self { bits, unknown, .. } = self.as_bits();
        if bits & !unknown != 0 || unknown == 0 {
            Ok(bits != 0)
        } else {
            Err(Open)
        }
    }

    pub(crate) fn allows(self, bits: u128) -> bool {
        (self.bits ^ bits) & !self.unknown == 0
            && !matches!(self.kind, Kind::Nan(width) if !is_nan(width, bits as u64))
    }

    /// One of the values.
    pub(crate) fn choose(self, random: &mut Random) -> Self {
        if self.unknown == 0 {
            return self.bits.into();
        }
        let filling = match random.below(4) {
            0 => 0,
            1 => u128::MAX,
            _ => random.next128(),
        };
        let chosen = self.bits & !self.unknown | filling & self.unknown;
        if self.allows(chosen) {
            chosen.into()
        } else {
            self.bits.into()
        }
    }

    /// Includes the values of both.
    pub(crate) fn join(self, other: Self) -> Self {
        if self == other {
            return self;
        }
        let (a, b) = (self.as_bits(), other.as_bits());
        Self::new(a.bits, a.unknown | b.unknown | a.bits ^ b.bits)
    }

    fn read(self, ty: Type) -> Reading {
        let width = ty.float_width();
        let is_marked = self.kind == Kind::Nan(width);
        read_float(width, self.bits as u64, self.unknown as u64, is_marked)
    }

    fn lane(self, width: FloatWidth, lane: u8) -> Reading {
        let size = width.width().size();
        let part = |vector| lanes::extract(size, Sign::Unsigned, vector, lane);
        read_float(width, part(self.bits), part(self.unknown), false)
    }

    /// For an operation that moves bits around, which does the same to the mask.
    pub(crate) fn map(self, f: impl Fn(u128) -> u128) -> Self {
        let this = self.as_bits();
        Self::new(f(this.bits), f(this.unknown))
    }
}

fn float_result(ty: Type, bits: u64, operands: &[Reading], quiets: bool) -> Datum {
    let width = ty.float_width();
    if operands.contains(&Reading::Unknown) {
        Datum::anything(ty)
    } else if is_nan(width, bits) {
        let unknown = open_bits_of_nan(width, operands, quiets);
        Datum {
            kind: Kind::Nan(width),
            ..Datum::scalar(canonical_nan(width), unknown)
        }
    } else {
        bits.into()
    }
}

/// An open bit affects the bits above it.
fn carried(ty: Type, unknown: u128) -> u128 {
    if unknown == 0 {
        0
    } else {
        all_bits(ty) & u128::MAX << unknown.trailing_zeros()
    }
}

pub(crate) fn unary(op: Unary, from: Type, to: Type, operand: Datum, quiets: bool) -> Datum {
    const HALF_SIGN: u64 = 0x8000;
    const HALF_NAN: u64 = 0x7e00;
    if op == Unary::Opaque {
        return operand;
    }
    let a = operand.as_bits();
    let apply = |bits: u128| evaluate::unary(op, from, to, bits as u64);
    let exact = || apply(a.bits).map_or_else(|| Datum::anything(to), Datum::from);
    match op {
        Unary::Bitcast => a,
        Unary::Neg if from.is_float() => Datum {
            bits: apply(a.bits).unwrap().into(),
            ..a
        },
        Unary::Abs => Datum {
            kind: a.kind,
            ..a.map(|bits| apply(bits).unwrap().into())
        },
        Unary::SwapBytes(_) | Unary::SignExtend(_) | Unary::Widen(_) | Unary::Wrap => {
            a.map(|bits| apply(bits).unwrap().into())
        }
        Unary::Neg => Datum::new(apply(a.bits).unwrap().into(), carried(to, a.unknown)),
        Unary::Sqrt | Unary::Round(_) | Unary::Promote | Unary::Demote => {
            float_result(to, apply(a.bits).unwrap(), &[a.read(from)], quiets)
        }
        Unary::HalfBitsToFloat => {
            let reading = if a.unknown & 0xffff != 0 {
                Reading::Unknown
            } else if a.bits as u64 & 0x7fff == HALF_NAN {
                Reading::CanonicalNan
            } else {
                Reading::OtherNan
            };
            float_result(to, apply(a.bits).unwrap(), &[reading], quiets)
        }
        Unary::FloatToHalfBits => match a.read(from) {
            Reading::Number => exact(),
            Reading::CanonicalNan => Datum::scalar(HALF_NAN, HALF_SIGN),
            Reading::OtherNan => Datum::scalar(HALF_NAN, HALF_SIGN | 0x1ff),
            Reading::Unknown => Datum::scalar(0, 0xffff),
        },
        Unary::FloatToInt(_)
        | Unary::FloatToIntSaturating(_)
        | Unary::FloatToInt32Modular
        | Unary::CanonicalizeNan => match a.read(from) {
            Reading::Unknown => Datum::anything(to),
            _ => exact(),
        },
        _ if a.unknown == 0 => exact(),
        Unary::CountLeadingZeros | Unary::CountTrailingZeros | Unary::CountOnes => {
            Datum::scalar(0, 0x7f)
        }
        _ => Datum::anything(to),
    }
}

fn frame_arithmetic(op: Binary, a: Datum, b: Datum) -> Option<Datum> {
    let result = evaluate::binary(op, Type::I64, a.bits as u64, b.bits as u64)?;
    match (op, a.kind, b.kind) {
        (Binary::Add | Binary::Sub, Kind::FrameAddress(segment), _) if b.is_known() => {
            Some(Datum::frame_address(segment, result))
        }
        (Binary::Add, _, Kind::FrameAddress(segment)) if a.is_known() => {
            Some(Datum::frame_address(segment, result))
        }
        (Binary::Sub, Kind::FrameAddress(first), Kind::FrameAddress(second)) if first == second => {
            Some(result.into())
        }
        _ => None,
    }
}

pub(crate) enum Partial {
    /// The operands are not allowed.
    Undefined,
    Open,
}

pub(crate) fn binary(
    op: Binary,
    ty: Type,
    lhs: Datum,
    rhs: Datum,
    quiets: bool,
) -> Result<Datum, Partial> {
    let apply = |a: u128, b: u128| evaluate::binary(op, ty, a as u64, b as u64);
    if ty.is_int() && lhs.is_known() && rhs.is_known() {
        return apply(lhs.bits, rhs.bits)
            .map(Datum::from)
            .ok_or(Partial::Undefined);
    }
    if ty == Type::I64
        && matches!(op, Binary::Add | Binary::Sub)
        && let Some(result) = frame_arithmetic(op, lhs, rhs)
    {
        return Ok(result);
    }
    let (a, b) = (lhs.as_bits(), rhs.as_bits());
    if ty.is_int() && op.is_partial() {
        let is_allowed = b.unknown == 0 && b.bits != 0 && b.bits != all_bits(ty);
        return if is_allowed {
            Ok(Datum::anything(ty))
        } else {
            Err(Partial::Open)
        };
    }
    let bits = apply(a.bits, b.bits).unwrap();
    let with_unknown = |unknown| Datum::new(bits.into(), unknown);
    let either = a.unknown | b.unknown;
    Ok(match op {
        Binary::And => with_unknown(either & (a.bits | a.unknown) & (b.bits | b.unknown)),
        Binary::Or => with_unknown(either & (!a.bits | a.unknown) & (!b.bits | b.unknown)),
        Binary::Xor => with_unknown(either),
        Binary::CopySign => Datum {
            kind: a.kind,
            ..with_unknown(apply(a.unknown, b.unknown).unwrap().into())
        },
        _ if ty.is_float() => float_result(ty, bits, &[a.read(ty), b.read(ty)], quiets),
        Binary::Add | Binary::Sub | Binary::Mul => with_unknown(carried(ty, either)),
        _ if op.is_shift() && b.unknown % u128::from(ty.width().bits()) == 0 => {
            with_unknown(apply(a.unknown, b.bits).unwrap().into())
        }
        _ => Datum::anything(ty),
    })
}

const ANY_BOOLEAN: Datum = Datum::new(0, 1);

pub(crate) fn compare(cond: Cond, ty: Type, lhs: Datum, rhs: Datum) -> Datum {
    let holds = || {
        u64::from(evaluate::compare(
            cond,
            ty,
            lhs.bits as u64,
            rhs.bits as u64,
        ))
    };
    let is_equality = matches!(cond, Cond::Eq | Cond::Ne);
    match (lhs.kind, rhs.kind) {
        _ if lhs.is_known() && rhs.is_known() => holds().into(),
        (Kind::FrameAddress(a), Kind::FrameAddress(b)) if a == b && is_equality => holds().into(),
        (Kind::Identity, Kind::Identity) if is_equality => holds().into(),
        _ => {
            let (a, b) = (lhs.as_bits(), rhs.as_bits());
            if is_equality && (a.bits ^ b.bits) & !(a.unknown | b.unknown) != 0 {
                holds().into()
            } else {
                ANY_BOOLEAN
            }
        }
    }
}

pub(crate) fn float_compare(cond: FloatCond, ty: Type, lhs: Datum, rhs: Datum) -> Datum {
    let is_nan = |reading| matches!(reading, Reading::CanonicalNan | Reading::OtherNan);
    let (a, b) = (lhs.read(ty), rhs.read(ty));
    if [a, b].contains(&Reading::Unknown) && !is_nan(a) && !is_nan(b) {
        return ANY_BOOLEAN;
    }
    let holds = evaluate::float_compare(cond, ty, lhs.bits as u64, rhs.bits as u64);
    u64::from(holds).into()
}

/// `None` if the result does not fit.
pub(crate) fn checked(op: Checked, ty: Type, a: Datum, b: Datum) -> Result<Option<Datum>, Open> {
    Ok(evaluate::checked(op, ty, a.known()?, b.known()?).map(Datum::from))
}

fn halves(wide: Result<u128, Open>) -> [Datum; 2] {
    wide.map_or_else(
        |Open| [Datum::anything(Type::I64); 2],
        |wide| [(wide as u64).into(), ((wide >> 64) as u64).into()],
    )
}

pub(crate) fn wide(op: Wide, operands: &[Datum; 4]) -> [Datum; 2] {
    let join =
        |low: Datum, high: Datum| Ok(u128::from(low.known()?) | u128::from(high.known()?) << 64);
    halves((|| {
        let (a, b) = (
            join(operands[0], operands[1])?,
            join(operands[2], operands[3])?,
        );
        Ok(match op {
            Wide::Add => a.wrapping_add(b),
            Wide::Sub => a.wrapping_sub(b),
        })
    })())
}

pub(crate) fn mul_wide(sign: Sign, a: Datum, b: Datum) -> [Datum; 2] {
    halves((|| {
        let (a, b) = (a.known()?, b.known()?);
        Ok(match sign {
            Sign::Signed => (i128::from(a as i64) * i128::from(b as i64)) as u128,
            Sign::Unsigned => u128::from(a) * u128::from(b),
        })
    })())
}

/// The lanes that an operation reads are the last that its name has.
fn lanes_read(name: &str) -> (Size, Option<FloatWidth>) {
    const SHAPES: [(&str, Size, Option<FloatWidth>); 6] = [
        ("I8x16", Size::S8, None),
        ("I16x8", Size::S16, None),
        ("I32x4", Size::S32, None),
        ("I64x2", Size::S64, None),
        ("F32x4", Size::S32, Some(FloatWidth::F32)),
        ("F64x2", Size::S64, Some(FloatWidth::F64)),
    ];
    SHAPES
        .iter()
        .filter_map(|&(shape, size, float)| Some((name.rfind(shape)?, size, float)))
        .max_by_key(|&(position, ..)| position)
        .map_or((Size::S8, None), |(_, size, float)| (size, float))
}

pub(crate) trait VectorOp: Copy {
    /// Their size, and their format if they are floats.
    fn lanes_read(self) -> (Size, Option<FloatWidth>);
}

macro_rules! vector_ops {
    ($($op:ident),*) => {
        $(impl VectorOp for $op {
            fn lanes_read(self) -> (Size, Option<FloatWidth>) {
                static TABLE: OnceLock<Vec<(Size, Option<FloatWidth>)>> = OnceLock::new();
                let table = TABLE.get_or_init(|| {
                    $op::ALL.iter().map(|op| lanes_read(&format!("{op:?}"))).collect()
                });
                table[self as usize]
            }
        })*
    };
}

vector_ops!(VectorUnary, VectorBinary, VectorTernary, VectorReduce);

fn vector_result(
    bits: u128,
    read: Option<FloatWidth>,
    nan_lanes: Option<FloatWidth>,
    operands: &[Datum],
) -> Datum {
    let Some(read) = read else {
        let is_known = operands.iter().all(|operand| operand.unknown == 0);
        return Datum::new(bits, if is_known { 0 } else { u128::MAX });
    };
    let count = lanes::count(read.width().size());
    let has_unknown = |operand: &Datum| {
        operand.unknown != 0 && (0..count).any(|lane| operand.lane(read, lane) == Reading::Unknown)
    };
    if operands.iter().any(has_unknown) {
        return Datum::anything(Type::V128);
    }
    let Some(written) = nan_lanes else {
        return bits.into();
    };
    let size = written.width().size();
    let mut unknown = 0;
    for lane in 0..lanes::count(size).min(count) {
        if is_nan(written, lanes::extract(size, Sign::Unsigned, bits, lane)) {
            let mut readings = [Reading::Number; 3];
            for (reading, operand) in readings.iter_mut().zip(operands) {
                *reading = operand.lane(read, lane);
            }
            let open = open_bits_of_nan(written, &readings, true);
            unknown = lanes::replace(size, unknown, lane, open);
        }
    }
    Datum::new(bits, unknown)
}

pub(crate) fn vector_unary(op: VectorUnary, relaxed: Relaxed, a: Datum) -> Datum {
    use VectorUnary::*;
    let bits = op.evaluate_with(relaxed, a.bits);
    match op {
        Not | F32x4Neg | F64x2Neg => Datum::new(bits, a.unknown),
        F32x4Abs | F64x2Abs => Datum::new(bits, op.evaluate(a.unknown)),
        _ if op.is_relaxed() && a.unknown != 0 => Datum::anything(Type::V128),
        _ => vector_result(bits, op.lanes_read().1, op.nan_lanes(), &[a]),
    }
}

fn select_bits(a: Datum, b: Datum, mask: Datum) -> Datum {
    let select = |a, b| VectorTernary::Bitselect.evaluate(a, b, mask.bits);
    let differ = a.unknown | b.unknown | a.bits ^ b.bits;
    Datum::new(
        select(a.bits, b.bits),
        select(a.unknown, b.unknown) | mask.unknown & differ,
    )
}

pub(crate) fn vector_binary(op: VectorBinary, relaxed: Relaxed, a: Datum, b: Datum) -> Datum {
    use VectorBinary::*;
    let bits = op.evaluate_with(relaxed, a.bits, b.bits);
    let either = a.unknown | b.unknown;
    let second_wins = relaxed.contains(Relaxed::SECOND_OPERAND_MIN_MAX);
    let second_if =
        |less, x, y, second, first| select_bits(second, first, vector_binary(less, relaxed, x, y));
    match op {
        And => Datum::new(bits, either & (a.bits | a.unknown) & (b.bits | b.unknown)),
        AndNot => Datum::new(bits, either & (a.bits | a.unknown) & (!b.bits | b.unknown)),
        Or => Datum::new(bits, either & (!a.bits | a.unknown) & (!b.bits | b.unknown)),
        Xor => Datum::new(bits, either),
        I8x16Swizzle | I8x16RelaxedSwizzle if b.unknown == 0 => {
            Datum::new(bits, op.evaluate_with(relaxed, a.unknown, b.bits))
        }
        F32x4Pmin => second_if(F32x4Lt, b, a, b, a),
        F32x4Pmax => second_if(F32x4Lt, a, b, b, a),
        F64x2Pmin => second_if(F64x2Lt, b, a, b, a),
        F64x2Pmax => second_if(F64x2Lt, a, b, b, a),
        F32x4RelaxedMin if second_wins => second_if(F32x4Lt, a, b, a, b),
        F32x4RelaxedMax if second_wins => second_if(F32x4Lt, b, a, a, b),
        F64x2RelaxedMin if second_wins => second_if(F64x2Lt, a, b, a, b),
        F64x2RelaxedMax if second_wins => second_if(F64x2Lt, b, a, a, b),
        _ => vector_result(bits, op.lanes_read().1, op.nan_lanes(), &[a, b]),
    }
}

pub(crate) fn vector_ternary(op: VectorTernary, relaxed: Relaxed, [a, b, c]: [Datum; 3]) -> Datum {
    if op == VectorTernary::Bitselect {
        return select_bits(a, b, c);
    }
    let bits = op.evaluate_with(relaxed, a.bits, b.bits, c.bits);
    vector_result(bits, op.lanes_read().1, op.nan_lanes(), &[a, b, c])
}

pub(crate) fn vector_shift(op: VectorShift, a: Datum, amount: Datum) -> Datum {
    debug_assert!(!matches!(op.kind(), Shift::RotateLeft | Shift::RotateRight));
    if amount.unknown.is_multiple_of(op.lanes().bits().into()) {
        a.map(|bits| op.evaluate(bits, amount.bits as u32))
    } else {
        Datum::anything(Type::V128)
    }
}

pub(crate) fn vector_reduce(op: VectorReduce, a: Datum) -> Datum {
    use VectorReduce::*;
    match op {
        I8x16Bitmask | I16x8Bitmask | I32x4Bitmask | I64x2Bitmask => {
            a.map(|bits| op.evaluate(bits).into())
        }
        _ if a.unknown == 0 => u64::from(op.evaluate(a.bits)).into(),
        _ => ANY_BOOLEAN,
    }
}
