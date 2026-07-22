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
        D: protocol::TryAdd + protocol::Zero + protocol::TrySign,
    {
        if let Some(res) = self.add_recursive(&other) {
            return res;
        }
        self.add_impl(other)
    }

    fn add_recursive(&self, other: &Self) -> Option<Self>
    where
        Self: crate::values::calc::CalcValue,
        D: protocol::TryAdd + protocol::Zero + protocol::TrySign,
    {
        match (self, other) {
            (Self::Dimension(a), Self::Dimension(b)) => {
                if let Some(res) = a.try_add(b) {
                    return Some(Self::Dimension(res));
                }
            }
            (Self::Percentage(a), Self::Percentage(b)) => {
                return Some(Self::Percentage(Percentage { v: a.v + b.v }));
            }
            (Self::Calc(this_calc), _) => match this_calc.as_ref() {
                Calc::Value(v) => return v.add_recursive(other),
                Calc::Sum { left, right } => {
                    // With owning Boxes we deep_clone the sum operands. The values
                    // are only read during this computation, so the clone is
                    // semantically equivalent (just extra allocation).
                    let left_calc = Self::Calc(left.deep_clone_boxed());
                    if let Some(res) = left_calc.add_recursive(other) {
                        return Some(res.add_impl(Self::Calc(right.deep_clone_boxed())));
                    }

                    let right_calc = Self::Calc(right.deep_clone_boxed());
                    if let Some(res) = right_calc.add_recursive(other) {
                        return Some(Self::Calc(left.deep_clone_boxed()).add_impl(res));
                    }
                }
                _ => {}
            },
            (_, Self::Calc(other_calc)) => match other_calc.as_ref() {
                Calc::Value(v) => return self.add_recursive(v),
                Calc::Sum { left, right } => {
                    let left_calc = Self::Calc(left.deep_clone_boxed());
                    if let Some(res) = self.add_recursive(&left_calc) {
                        return Some(res.add_impl(Self::Calc(right.deep_clone_boxed())));
                    }

                    let right_calc = Self::Calc(right.deep_clone_boxed());
                    if let Some(res) = self.add_recursive(&right_calc) {
                        return Some(Self::Calc(left.deep_clone_boxed()).add_impl(res));
                    }
                }
                _ => {}
            },
            _ => {}
        }

        None
    }

    fn add_impl(self, other: Self) -> Self
    where
        Self: crate::values::calc::CalcValue,
        D: protocol::Zero + protocol::TrySign,
    {
        let mut a = self;
        let mut b = other;

        if a.is_zero() {
            return b;
        }
        if b.is_zero() {
            return a;
        }

        if a.is_sign_negative() && b.is_sign_positive() {
            core::mem::swap(&mut a, &mut b);
        }

        match (a, b) {
            (Self::Calc(a_calc), b)
                if matches!(*a_calc, Calc::Value(_)) && !matches!(b, Self::Calc(_)) =>
            {
                let Calc::Value(v) = *a_calc else {
                    unreachable!()
                };
                v.add_impl(b)
            }
            (a, Self::Calc(b_calc))
                if matches!(*b_calc, Calc::Value(_)) && !matches!(a, Self::Calc(_)) =>
            {
                let Calc::Value(v) = *b_calc else {
                    unreachable!()
                };
                a.add_impl(*v)
            }
            (a, b) => Self::Calc(Box::new(Calc::Sum {
                left: Box::new(a.into_calc()),
                right: Box::new(b.into_calc()),
            })),
        }
    }

    #[inline]
    fn is_sign_positive(&self) -> bool
    where
        Self: crate::values::calc::CalcValue,
        D: protocol::TrySign,
    {
        let Some(sign) = self.try_sign() else {
            return false;
        };
        sign.is_sign_positive()
    }

    #[inline]
    fn is_sign_negative(&self) -> bool
    where
        Self: crate::values::calc::CalcValue,
        D: protocol::TrySign,
    {
        let Some(sign) = self.try_sign() else {
            return false;
        };
        sign.is_sign_negative()
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

    // pub fn parse(input: *css.Parser) Result(NumberOrPercentage) {
    //     _ = input; // autofix
    //     @panic(css.todo_stuff.depth);
    // }

    // pub fn toCss(this: *const NumberOrPercentage, dest: *css.Printer) css.PrintErr!void {
    //     _ = this; // autofix
    //     _ = dest; // autofix
    //     @panic(css.todo_stuff.depth);
    // }

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
