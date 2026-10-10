use crate::css_parser as css;
use crate::css_parser::{CssResult, ParserError, PrintErr, Printer, Token};
use crate::targets::Browsers;
use crate::values::angle::Angle;
use crate::values::calc::Calc;
use crate::values::number::CSSNumber;
use crate::values::protocol;
use core::cmp::Ordering;

#[derive(Debug, Clone, Copy)]
pub struct Percentage {
    pub(crate) v: CSSNumber,
}

impl Percentage {
    pub(crate) fn parse(input: &mut css::Parser) -> CssResult<Percentage> {
        if let Ok(calc_value) = input.try_parse(Calc::<Percentage>::parse) {
            if let Calc::Value(v) = calc_value {
                return Ok(*v);
            }
            // Handle calc() expressions that can't be reduced to a simple value (e.g., containing NaN, variables, etc.)
            // Return an error since we can't determine the percentage value at parse time
            return Err(input.new_custom_error(ParserError::invalid_value));
        }

        let percent = input.expect_percentage()?;
        Ok(Percentage { v: percent })
    }

    pub(crate) fn to_css(self, dest: &mut Printer) -> Result<(), PrintErr> {
        let x = self.v * 100.0;
        let int_value: Option<i32> = if (x - x.trunc()) == 0.0 {
            Some(self.v as i32)
        } else {
            None
        };

        let percent = Token::Percentage {
            has_sign: self.v < 0.0,
            unit_value: self.v,
            int_value,
        };

        if self.v != 0.0 && self.v.abs() < 0.01 {
            let mut backing = [0u8; 32];
            let mut fbs = css::serializer::FixedBufWriter::new_mut(&mut backing);
            if percent.to_css_generic(&mut fbs).is_err() {
                return Err(dest.add_fmt_error());
            }
            let buf = fbs.get_written();
            if self.v < 0.0 {
                dest.write_char(b'-')?;
                dest.write_str(bun_core::strings::trim_leading_pattern2(buf, b'-', b'0'))?;
            } else {
                dest.write_str(bun_core::trim_leading_char(buf, b'0'))?;
            }
            Ok(())
        } else {
            percent.to_css(dest)
        }
    }

    #[inline]
    pub(crate) fn eql(self, other: Percentage) -> bool {
        self.v == other.v
    }

    pub(crate) fn add_internal(self, other: Percentage) -> Percentage {
        self.add(other)
    }

    fn add(self, rhs: Percentage) -> Percentage {
        Percentage { v: self.v + rhs.v }
    }

    pub(crate) fn mul_f32(self, other: f32) -> Percentage {
        Percentage { v: self.v * other }
    }

    pub(crate) fn is_zero(self) -> bool {
        self.v == 0.0
    }

    pub(crate) fn sign(self) -> f32 {
        css::signfns::sign_f32(self.v)
    }

    fn try_sign(self) -> Option<f32> {
        Some(self.sign())
    }

    pub(crate) fn partial_cmp(self, other: Percentage) -> Option<Ordering> {
        crate::generic::partial_cmp_f32(self.v, other.v)
    }

    pub(crate) fn try_map(self, _map_fn: impl Fn(f32) -> f32) -> Option<Percentage> {
        // Percentages cannot be mapped because we don't know what they will resolve to.
        // For example, they might be positive or negative depending on what they are a
        // percentage of, which we don't know.
        None
    }

    pub(crate) fn op_to<R, C>(
        self,
        other: Percentage,
        ctx: C,
        op_fn: impl Fn(C, f32, f32) -> R,
    ) -> R {
        op_fn(ctx, self.v, other.v)
    }

    pub(crate) fn try_op<C>(
        self,
        other: Percentage,
        ctx: C,
        op_fn: impl Fn(C, f32, f32) -> f32,
    ) -> Option<Percentage> {
        Some(Percentage {
            v: op_fn(ctx, self.v, other.v),
        })
    }
}

pub enum DimensionPercentage<D> {
    Dimension(D),
    Percentage(Percentage),
    // LIFETIMES.tsv: OWNED → Box<Calc<DimensionPercentage<D>>>
    Calc(Box<Calc<DimensionPercentage<D>>>),
}

impl<D: Clone> Clone for DimensionPercentage<D> {
    fn clone(&self) -> Self {
        match self {
            Self::Dimension(d) => Self::Dimension(d.clone()),
            Self::Percentage(p) => Self::Percentage(*p),
            Self::Calc(c) => Self::Calc(Box::new(c.deep_clone())),
        }
    }
}

impl<D: PartialEq + Clone> PartialEq for DimensionPercentage<D> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Dimension(a), Self::Dimension(b)) => a == b,
            (Self::Percentage(a), Self::Percentage(b)) => a.eql(*b),
            (Self::Calc(a), Self::Calc(b)) => **a == **b,
            _ => false,
        }
    }
}

// `Zero`/`MulF32`/`TryAdd`/`Parse` protocol traits live in
// `crate::values::protocol`. Bounds on `D` are expressed via per-method
// `where` clauses, so plain `DimensionPercentage<D>` (no behavior) needs no
// bounds at all.
impl<D> DimensionPercentage<D> {
    pub(crate) fn parse(input: &mut css::Parser) -> CssResult<Self>
    where
        Self: crate::values::calc::CalcValue,
        D: protocol::Parse,
    {
        if let Ok(calc_value) = input.try_parse(Calc::<Self>::parse) {
            if let Calc::Value(v) = calc_value {
                return Ok(*v);
            }
            return Ok(Self::Calc(Box::new(calc_value)));
        }

        if let Ok(length) = input.try_parse(D::parse) {
            return Ok(Self::Dimension(length));
        }

        if let Ok(percentage) = input.try_parse(Percentage::parse) {
            return Ok(Self::Percentage(percentage));
        }

        Err(input.new_error_for_next_token())
    }

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr>
    where
        Self: crate::values::calc::CalcValue,
        D: protocol::ToCss,
    {
        match self {
            Self::Dimension(length) => length.to_css(dest),
            Self::Percentage(per) => per.to_css(dest),
            Self::Calc(calc) => calc.to_css(dest),
        }
    }

    pub(crate) fn is_compatible(&self, browsers: &Browsers) -> bool
    where
        Self: crate::values::calc::CalcValue,
        D: protocol::IsCompatible,
    {
        match self {
            Self::Dimension(d) => d.is_compatible(browsers),
            Self::Calc(c) => c.is_compatible(browsers),
            Self::Percentage(_) => true,
        }
    }

    pub(crate) fn deep_clone(&self) -> Self
    where
        D: Clone,
    {
        match self {
            // D: Clone covers POD types too — Copy types' clone is a bitwise copy.
            Self::Dimension(d) => Self::Dimension(d.clone()),
            Self::Percentage(p) => Self::Percentage(*p),
            Self::Calc(calc) => Self::Calc(Box::new(calc.deep_clone())),
        }
    }

    // No explicit `impl Drop` needed — Box<Calc<...>> frees via Drop; D's Drop
    // (if any) runs automatically.

    pub(crate) fn zero() -> Self
    where
        D: protocol::Zero,
    {
        Self::Dimension(D::zero())
    }

    pub(crate) fn is_zero(&self) -> bool
    where
        D: protocol::Zero,
    {
        match self {
            Self::Dimension(d) => d.is_zero(),
            Self::Percentage(p) => p.is_zero(),
            _ => false,
        }
    }

    fn mul_value_f32(lhs: D, rhs: f32) -> D
    where
        D: protocol::MulF32,
    {
        lhs.mul_f32(rhs)
    }

    pub(crate) fn mul_f32(self, other: f32) -> Self
    where
        Self: crate::values::calc::CalcValue,
        D: protocol::MulF32,
    {
        match self {
            Self::Dimension(d) => Self::Dimension(Self::mul_value_f32(d, other)),
            Self::Percentage(p) => Self::Percentage(p.mul_f32(other)),
            Self::Calc(c) => Self::Calc(Box::new(c.mul_f32(other))),
        }
    }

    pub(crate) fn add_internal(self, other: Self) -> Self
    where
        Self: crate::values::calc::CalcValue,
    {
        Calc::add_values(self, other, Self::Calc)
    }

    /// The sum of two values of like units, when neither is a `calc()`.
    pub(crate) fn try_add(&self, other: &Self) -> Option<Self>
    where
        D: protocol::TryAdd,
    {
        match (self, other) {
            (Self::Dimension(a), Self::Dimension(b)) => a.try_add(b).map(Self::Dimension),
            (Self::Percentage(a), Self::Percentage(b)) => {
                Some(Self::Percentage(Percentage { v: a.v + b.v }))
            }
            _ => None,
        }
    }

    pub(crate) fn partial_cmp(&self, other: &Self) -> Option<Ordering>
    where
        D: protocol::PartialCmp,
    {
        match (self, other) {
            (Self::Dimension(a), Self::Dimension(b)) => a.partial_cmp(b),
            (Self::Percentage(a), Self::Percentage(b)) => Percentage::partial_cmp(*a, *b),
            _ => None,
        }
    }

    pub(crate) fn try_sign(&self) -> Option<f32>
    where
        Self: crate::values::calc::CalcValue,
        D: protocol::TrySign,
    {
        match self {
            Self::Dimension(d) => d.try_sign(),
            Self::Percentage(p) => p.try_sign(),
            Self::Calc(c) => c.try_sign(),
        }
    }

    pub(crate) fn try_from_angle(angle: Angle) -> Option<Self>
    where
        D: protocol::TryFromAngle,
    {
        Some(Self::Dimension(D::try_from_angle(angle)?))
    }

    pub(crate) fn try_map(&self, map_fn: impl Fn(f32) -> f32) -> Option<Self>
    where
        D: protocol::TryMap,
    {
        match self {
            Self::Dimension(vv) => vv.try_map(map_fn).map(Self::Dimension),
            _ => None,
        }
    }

    pub(crate) fn into_calc(self) -> Calc<DimensionPercentage<D>> {
        match self {
            Self::Calc(calc) => *calc,
            other => Calc::Value(Box::new(other)),
        }
    }
}

/// Either a `<number>` or `<percentage>`.
#[derive(Debug, Clone, PartialEq)]
pub enum NumberOrPercentage {
    /// A number.
    Number(CSSNumber),
    /// A percentage.
    Percentage(Percentage),
}

impl NumberOrPercentage {
    // Hand-rolled as the trivial two-variant try-parse cascade so
    // `AlphaValue::parse` doesn't panic at runtime.
    pub(crate) fn parse(input: &mut css::Parser) -> CssResult<NumberOrPercentage> {
        if let Ok(n) = input.try_parse(crate::values::number::CSSNumberFns::parse) {
            return Ok(NumberOrPercentage::Number(n));
        }
        Percentage::parse(input).map(NumberOrPercentage::Percentage)
    }

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            NumberOrPercentage::Number(n) => crate::values::number::CSSNumberFns::to_css(*n, dest),
            NumberOrPercentage::Percentage(p) => p.to_css(dest),
        }
    }

    pub(crate) fn into_f32(&self) -> f32 {
        match self {
            Self::Number(n) => *n,
            Self::Percentage(p) => p.v,
        }
    }
}

impl PartialEq for Percentage {
    fn eq(&self, other: &Self) -> bool {
        self.v == other.v
    }
}

crate::css_eql_partialeq!(NumberOrPercentage);
