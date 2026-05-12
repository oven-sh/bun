use crate::css_parser as css;
use crate::css_parser::{CssResult, ParserError, PrintErr, Printer, Token};
use crate::targets::Browsers;
use crate::values::angle::Angle;
use crate::values::calc::{Calc, MathFunction};
use crate::values::number::CSSNumber;
use crate::values::protocol;
use core::cmp::Ordering;

#[derive(Debug, Clone, Copy)]
pub struct Percentage {
    pub v: CSSNumber,
}

impl Percentage {
    pub fn parse(input: &mut css::Parser) -> CssResult<Percentage> {
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

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        let x = self.v * 100.0;
        let int_value: Option<i32> = if (x - x.trunc()) == 0.0 {
            // PORT NOTE: Rust `as` saturates on overflow/NaN where Zig is UB.
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
            // TODO(port): fixed-size stack writer — Zig used std.Io.Writer.fixed over [32]u8.
            let mut backing = [0u8; 32];
            let mut fbs = css::serializer::FixedBufWriter::new_mut(&mut backing);
            if percent.to_css_generic(&mut fbs).is_err() {
                return Err(dest.add_fmt_error());
            }
            let buf = fbs.get_written();
            if self.v < 0.0 {
                dest.write_char(b'-')?;
                dest.write_str(bun_core::strings::trim_leading_pattern2(&buf, b'-', b'0'))?;
            } else {
                dest.write_str(bun_core::trim_leading_char(&buf, b'0'))?;
            }
            Ok(())
        } else {
            percent.to_css(dest)
        }
    }

    #[inline]
    pub fn eql(&self, other: &Percentage) -> bool {
        self.v == other.v
    }

    pub fn add_internal(self, other: Percentage) -> Percentage {
        self.add(other)
    }

    pub fn add(self, rhs: Percentage) -> Percentage {
        Percentage { v: self.v + rhs.v }
    }

    pub fn into_calc(self) -> Calc<Percentage> {
        // PERF(port): was arena alloc (bun.create) — profile in Phase B.
        Calc::Value(Box::new(self))
    }

    pub fn mul_f32(self, other: f32) -> Percentage {
        Percentage { v: self.v * other }
    }

    pub fn is_zero(&self) -> bool {
        self.v == 0.0
    }

    pub fn sign(&self) -> f32 {
        css::signfns::sign_f32(self.v)
    }

    pub fn try_sign(&self) -> Option<f32> {
        Some(self.sign())
    }

    pub fn partial_cmp(&self, other: &Percentage) -> Option<Ordering> {
        crate::generic::partial_cmp_f32(&self.v, &other.v)
    }

    pub fn try_from_angle(_: Angle) -> Option<Percentage> {
        None
    }

    pub fn try_map(&self, _map_fn: impl Fn(f32) -> f32) -> Option<Percentage> {
        // Percentages cannot be mapped because we don't know what they will resolve to.
        // For example, they might be positive or negative depending on what they are a
        // percentage of, which we don't know.
        None
    }

    pub fn op<C>(
        &self,
        other: &Percentage,
        ctx: C,
        op_fn: impl Fn(C, f32, f32) -> f32,
    ) -> Percentage {
        Percentage {
            v: op_fn(ctx, self.v, other.v),
        }
    }

    pub fn op_to<R, C>(&self, other: &Percentage, ctx: C, op_fn: impl Fn(C, f32, f32) -> R) -> R {
        op_fn(ctx, self.v, other.v)
    }

    pub fn try_op<C>(
        &self,
        other: &Percentage,
        ctx: C,
        op_fn: impl Fn(C, f32, f32) -> f32,
    ) -> Option<Percentage> {
        Some(Percentage {
            v: op_fn(ctx, self.v, other.v),
        })
    }
}

// TODO(port): `needsDeepclone` was a comptime type-switch (Angle→false, LengthValue→false,
// else @compileError). In Rust, `D: Clone` makes this distinction irrelevant for Copy types
// (clone is memcpy). If a deep-clone protocol is required for non-Copy D, add a trait bound.

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
            (Self::Percentage(a), Self::Percentage(b)) => a.eql(b),
            (Self::Calc(a), Self::Calc(b)) => **a == **b,
            _ => false,
        }
    }
}

// ─── B-2 round 5: generic-D method block un-gated ─────────────────────────
// `Zero`/`MulF32`/`TryAdd`/`Parse` protocol traits live in
// `crate::values::protocol` until `generics::parse_tocss_numeric_gated`
// un-gates. The bound set below mirrors the full Zig comptime-method surface
// on `D`; per-method `where` clauses narrow further so plain
// `DimensionPercentage<D>` (no behavior) needs only `D: Clone`.
impl<D> DimensionPercentage<D>
where
    // TODO(port): narrow these bounds in Phase B; mirroring methods called on D below.
    D: Clone,
{
    pub fn parse(input: &mut css::Parser) -> CssResult<Self>
    where
        Self: crate::values::calc::CalcValue,
        D: protocol::Parse,
    {
        if let Ok(calc_value) = input.try_parse(Calc::<Self>::parse) {
            if let Calc::Value(v) = calc_value {
                return Ok(*v);
            }
            // PERF(port): was arena alloc (bun.create with input.arena()) — profile in Phase B.
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

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr>
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

    pub fn is_compatible(&self, browsers: Browsers) -> bool
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

    pub fn eql(&self, other: &Self) -> bool
    where
        D: PartialEq,
    {
        // TODO(port): Zig used css.implementEql (reflection). Phase B: #[derive(PartialEq)] on enum.
        self == other
    }

    pub fn deep_clone(&self) -> Self {
        match self {
            // PORT NOTE: Zig branched on `comptime needs_deepclone` to avoid cloning POD types.
            // In Rust, D: Clone covers both — Copy types' clone is a bitwise copy.
            Self::Dimension(d) => Self::Dimension(d.clone()),
            Self::Percentage(p) => Self::Percentage(*p),
            // PERF(port): was arena alloc (bun.create) — profile in Phase B.
            Self::Calc(calc) => Self::Calc(Box::new(calc.deep_clone())),
        }
    }

    // PORT NOTE: `deinit` dropped — Box<Calc<...>> frees via Drop; D's Drop (if any) runs
    // automatically. Zig body only freed owned fields, so no explicit `impl Drop` needed.

    pub fn zero() -> Self
    where
        D: protocol::Zero,
    {
        // TODO(port): Zig special-cased D == f32 → 0.0. Handle via trait impl on f32 in Phase B.
        Self::Dimension(D::zero())
    }

    pub fn is_zero(&self) -> bool
    where
        D: protocol::Zero,
    {
        match self {
            // TODO(port): Zig special-cased D == f32 → d == 0.0. Handle via trait impl on f32.
            Self::Dimension(d) => d.is_zero(),
            Self::Percentage(p) => p.is_zero(),
            _ => false,
        }
    }

    fn mul_value_f32(lhs: D, rhs: f32) -> D
    where
        D: protocol::MulF32,
    {
        // TODO(port): Zig special-cased D == f32 → lhs * rhs. Handle via trait impl on f32.
        lhs.mul_f32(rhs)
    }

    pub fn mul_f32(self, other: f32) -> Self
    where
        Self: crate::values::calc::CalcValue,
        D: protocol::MulF32,
    {
        match self {
            Self::Dimension(d) => Self::Dimension(Self::mul_value_f32(d, other)),
            Self::Percentage(p) => Self::Percentage(p.mul_f32(other)),
            // PERF(port): was arena alloc (bun.create) — profile in Phase B.
            Self::Calc(c) => Self::Calc(Box::new(c.mul_f32(other))),
        }
    }

    pub fn add(self, other: Self) -> Self
    where
        Self: crate::values::calc::CalcValue,
        D: protocol::TryAdd + protocol::Zero + protocol::TrySign + protocol::MulF32,
    {
        // Unwrap calc(...) functions so we can add inside.
        // Then wrap the result in a calc(...) again if necessary.
        let a = self.unwrap_calc();
        let b = other.unwrap_calc();
        let res = a.add_internal(b);
        match res {
            Self::Calc(c) => match *c {
                Calc::Value(l) => *l,
                Calc::Function(f) => {
                    if !matches!(*f, MathFunction::Calc(_)) {
                        // PERF(port): was arena alloc (bun.create) — profile in Phase B.
                        Self::Calc(Box::new(Calc::Function(f)))
                    } else {
                        Self::Calc(Box::new(Calc::Function(Box::new(MathFunction::Calc(
                            Calc::Function(f),
                        )))))
                    }
                }
                other_calc => Self::Calc(Box::new(Calc::Function(Box::new(MathFunction::Calc(
                    other_calc,
                ))))),
            },
            other_res => other_res,
        }
    }

    pub fn add_internal(self, other: Self) -> Self
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
                    // PORT NOTE: reshaped for borrowck — Zig wrapped sum.left/right (raw ptrs)
                    // directly in This{.calc = ...}. Here we deep_clone since Box is owning.
                    // TODO(port): lifetime — sum.left/right ownership semantics need review.
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
            (a, b) => {
                // PERF(port): was arena alloc (bun.create) — profile in Phase B.
                Self::Calc(Box::new(Calc::Sum {
                    left: Box::new(a.into_calc()),
                    right: Box::new(b.into_calc()),
                }))
            }
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

    fn unwrap_calc(self) -> Self {
        match self {
            Self::Calc(calc) => match *calc {
                Calc::Function(f) => match *f {
                    // PERF(port): was arena alloc (bun.create) — profile in Phase B.
                    MathFunction::Calc(c2) => Self::Calc(Box::new(c2)),
                    other_fn => Self::Calc(Box::new(Calc::Function(Box::new(other_fn)))),
                },
                other_calc => Self::Calc(Box::new(other_calc)),
            },
            other => other,
        }
    }

    pub fn partial_cmp(&self, other: &Self) -> Option<Ordering>
    where
        D: protocol::PartialCmp,
    {
        match (self, other) {
            (Self::Dimension(a), Self::Dimension(b)) => a.partial_cmp(b),
            (Self::Percentage(a), Self::Percentage(b)) => a.partial_cmp(b),
            _ => None,
        }
    }

    pub fn try_sign(&self) -> Option<f32>
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

    pub fn try_from_angle(angle: Angle) -> Option<Self>
    where
        D: protocol::TryFromAngle,
    {
        Some(Self::Dimension(D::try_from_angle(angle)?))
    }

    pub fn try_map(&self, map_fn: impl Fn(f32) -> f32) -> Option<Self>
    where
        D: protocol::TryMap,
    {
        match self {
            Self::Dimension(vv) => vv.try_map(map_fn).map(Self::Dimension),
            _ => None,
        }
    }

    pub fn try_op<C>(
        &self,
        other: &Self,
        ctx: C,
        op_fn: impl Fn(C, f32, f32) -> f32,
    ) -> Option<Self>
    where
        C: Copy,
        D: protocol::TryOp,
    {
        match (self, other) {
            (Self::Dimension(a), Self::Dimension(b)) => {
                Some(Self::Dimension(a.try_op(b, ctx, &op_fn)?))
            }
            (Self::Percentage(a), Self::Percentage(b)) => Some(Self::Percentage(Percentage {
                v: op_fn(ctx, a.v, b.v),
            })),
            _ => None,
        }
    }

    pub fn try_op_to<R, C>(
        &self,
        other: &Self,
        ctx: C,
        op_fn: impl Fn(C, f32, f32) -> R,
    ) -> Option<R>
    where
        C: Copy,
        D: protocol::TryOpTo,
    {
        match (self, other) {
            (Self::Dimension(a), Self::Dimension(b)) => a.try_op_to(b, ctx, &op_fn),
            (Self::Percentage(a), Self::Percentage(b)) => Some(op_fn(ctx, a.v, b.v)),
            _ => None,
        }
    }

    pub fn into_calc(self) -> Calc<DimensionPercentage<D>> {
        match self {
            Self::Calc(calc) => *calc,
            // PERF(port): was arena alloc (bun.create) — profile in Phase B.
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
    // PORT NOTE: Zig used `css.DeriveParse(@This()).parse` / `css.DeriveToCss(@This()).toCss`
    // (comptime reflection derives). Hand-rolled here as the trivial two-variant
    // try-parse cascade so `AlphaValue::parse` doesn't panic at runtime.
    pub fn parse(input: &mut css::Parser) -> CssResult<NumberOrPercentage> {
        if let Ok(n) = input.try_parse(crate::values::number::CSSNumberFns::parse) {
            return Ok(NumberOrPercentage::Number(n));
        }
        Percentage::parse(input).map(NumberOrPercentage::Percentage)
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            NumberOrPercentage::Number(n) => crate::values::number::CSSNumberFns::to_css(n, dest),
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

    pub fn deep_clone(&self) -> NumberOrPercentage {
        // PORT NOTE: Zig used css.implementDeepClone (reflection) → #[derive(Clone)].
        self.clone()
    }

    pub fn into_f32(&self) -> f32 {
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

// ported from: src/css/values/percentage.zig
