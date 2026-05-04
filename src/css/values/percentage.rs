use crate as css;
use crate::css_values::angle::Angle;
use crate::css_values::calc::{Calc, MathFunction};
use crate::css_values::number::CSSNumber;
use crate::targets::Browsers;
use crate::{PrintErr, Printer, Result as CssResult};
use core::cmp::Ordering;

#[derive(Debug, Clone, Copy)]
pub struct Percentage {
    pub v: CSSNumber,
}

impl Percentage {
    pub fn parse(input: &mut css::Parser) -> CssResult<Percentage> {
        if let Some(calc_value) = input.try_parse(Calc::<Percentage>::parse).as_value() {
            if let Calc::Value(v) = calc_value {
                return CssResult::Ok(*v);
            }
            // Handle calc() expressions that can't be reduced to a simple value (e.g., containing NaN, variables, etc.)
            // Return an error since we can't determine the percentage value at parse time
            return CssResult::Err(input.new_custom_error(css::ParserError::InvalidValue));
        }

        let percent = match input.expect_percentage() {
            CssResult::Ok(vv) => vv,
            CssResult::Err(e) => return CssResult::Err(e),
        };

        CssResult::Ok(Percentage { v: percent })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        let x = self.v * 100.0;
        let int_value: Option<i32> = if (x - x.trunc()) == 0.0 {
            // PORT NOTE: Rust `as` saturates on overflow/NaN where Zig is UB.
            Some(self.v as i32)
        } else {
            None
        };

        let percent = css::Token::Percentage {
            has_sign: self.v < 0.0,
            unit_value: self.v,
            int_value,
        };

        if self.v != 0.0 && self.v.abs() < 0.01 {
            // TODO(port): fixed-size stack writer — Zig used std.Io.Writer.fixed over [32]u8.
            // PERF(port): was stack buffer; using small Vec for now — profile in Phase B.
            let mut buf: Vec<u8> = Vec::with_capacity(32);
            if percent.to_css_generic(&mut buf).is_err() {
                return dest.add_fmt_error();
            }
            if self.v < 0.0 {
                dest.write_char('-')?;
                dest.write_str(bun_str::strings::trim_leading_pattern2(&buf, b'-', b'0'))?;
            } else {
                dest.write_str(bun_str::strings::trim_leading_char(&buf, b'0'))?;
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
        css::generic::partial_cmp(&self.v, &other.v)
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

    pub fn op_to<R, C>(
        &self,
        other: &Percentage,
        ctx: C,
        op_fn: impl Fn(C, f32, f32) -> R,
    ) -> R {
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

#[derive(Debug)]
pub enum DimensionPercentage<D> {
    Dimension(D),
    Percentage(Percentage),
    // LIFETIMES.tsv: OWNED → Box<Calc<DimensionPercentage<D>>>
    Calc(Box<Calc<DimensionPercentage<D>>>),
}

impl<D> DimensionPercentage<D>
where
    // TODO(port): narrow these bounds in Phase B; mirroring methods called on D below.
    D: Clone,
{
    pub fn parse(input: &mut css::Parser) -> CssResult<Self>
    where
        D: css::generic::Parse,
    {
        if let Some(calc_value) = input.try_parse(Calc::<Self>::parse).as_value() {
            if let Calc::Value(v) = calc_value {
                return CssResult::Ok(*v);
            }
            // PERF(port): was arena alloc (bun.create with input.allocator()) — profile in Phase B.
            return CssResult::Ok(Self::Calc(Box::new(calc_value)));
        }

        if let Some(length) = input.try_parse(D::parse).as_value() {
            return CssResult::Ok(Self::Dimension(length));
        }

        if let Some(percentage) = input.try_parse(Percentage::parse).as_value() {
            return CssResult::Ok(Self::Percentage(percentage));
        }

        CssResult::Err(input.new_error_for_next_token())
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr>
    where
        D: css::generic::ToCss,
    {
        match self {
            Self::Dimension(length) => length.to_css(dest),
            Self::Percentage(per) => per.to_css(dest),
            Self::Calc(calc) => calc.to_css(dest),
        }
    }

    pub fn is_compatible(&self, browsers: Browsers) -> bool
    where
        D: css::generic::IsCompatible,
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
        match (self, other) {
            (Self::Dimension(a), Self::Dimension(b)) => a == b,
            (Self::Percentage(a), Self::Percentage(b)) => a.eql(b),
            (Self::Calc(a), Self::Calc(b)) => a.eql(b),
            _ => false,
        }
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
        D: css::generic::Zero,
    {
        // TODO(port): Zig special-cased D == f32 → 0.0. Handle via trait impl on f32 in Phase B.
        Self::Dimension(D::zero())
    }

    pub fn is_zero(&self) -> bool
    where
        D: css::generic::Zero,
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
        D: css::generic::MulF32,
    {
        // TODO(port): Zig special-cased D == f32 → lhs * rhs. Handle via trait impl on f32.
        lhs.mul_f32(rhs)
    }

    pub fn mul_f32(self, other: f32) -> Self
    where
        D: css::generic::MulF32,
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
        D: css::generic::TryAdd + css::generic::Zero + css::generic::TrySign + css::generic::MulF32,
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
        D: css::generic::TryAdd + css::generic::Zero + css::generic::TrySign,
    {
        if let Some(res) = self.add_recursive(&other) {
            return res;
        }
        self.add_impl(other)
    }

    fn add_recursive(&self, other: &Self) -> Option<Self>
    where
        D: css::generic::TryAdd + css::generic::Zero + css::generic::TrySign,
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
                Calc::Sum(sum) => {
                    // PORT NOTE: reshaped for borrowck — Zig wrapped sum.left/right (raw ptrs)
                    // directly in This{.calc = ...}. Here we deep_clone since Box is owning.
                    // TODO(port): lifetime — sum.left/right ownership semantics need review.
                    let left_calc = Self::Calc(sum.left.deep_clone_boxed());
                    if let Some(res) = left_calc.add_recursive(other) {
                        return Some(res.add_impl(Self::Calc(sum.right.deep_clone_boxed())));
                    }

                    let right_calc = Self::Calc(sum.right.deep_clone_boxed());
                    if let Some(res) = right_calc.add_recursive(other) {
                        return Some(
                            Self::Calc(sum.left.deep_clone_boxed()).add_impl(res),
                        );
                    }
                }
                _ => {}
            },
            (_, Self::Calc(other_calc)) => match other_calc.as_ref() {
                Calc::Value(v) => return self.add_recursive(v),
                Calc::Sum(sum) => {
                    let left_calc = Self::Calc(sum.left.deep_clone_boxed());
                    if let Some(res) = self.add_recursive(&left_calc) {
                        return Some(res.add_impl(Self::Calc(sum.right.deep_clone_boxed())));
                    }

                    let right_calc = Self::Calc(sum.right.deep_clone_boxed());
                    if let Some(res) = self.add_recursive(&right_calc) {
                        return Some(
                            Self::Calc(sum.left.deep_clone_boxed()).add_impl(res),
                        );
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
        D: css::generic::Zero + css::generic::TrySign,
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
            (Self::Calc(a_calc), b) if matches!(*a_calc, Calc::Value(_)) && !matches!(b, Self::Calc(_)) => {
                let Calc::Value(v) = *a_calc else { unreachable!() };
                v.add_impl(b)
            }
            (a, Self::Calc(b_calc)) if matches!(*b_calc, Calc::Value(_)) && !matches!(a, Self::Calc(_)) => {
                let Calc::Value(v) = *b_calc else { unreachable!() };
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
        D: css::generic::TrySign,
    {
        let Some(sign) = self.try_sign() else {
            return false;
        };
        css::signfns::is_sign_positive(sign)
    }

    #[inline]
    fn is_sign_negative(&self) -> bool
    where
        D: css::generic::TrySign,
    {
        let Some(sign) = self.try_sign() else {
            return false;
        };
        css::signfns::is_sign_negative(sign)
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
        D: css::generic::PartialCmp,
    {
        match (self, other) {
            (Self::Dimension(a), Self::Dimension(b)) => a.partial_cmp(b),
            (Self::Percentage(a), Self::Percentage(b)) => a.partial_cmp(b),
            _ => None,
        }
    }

    pub fn try_sign(&self) -> Option<f32>
    where
        D: css::generic::TrySign,
    {
        match self {
            Self::Dimension(d) => css::generic::try_sign(d),
            Self::Percentage(p) => p.try_sign(),
            Self::Calc(c) => c.try_sign(),
        }
    }

    pub fn try_from_angle(angle: Angle) -> Option<Self>
    where
        D: css::generic::TryFromAngle,
    {
        Some(Self::Dimension(D::try_from_angle(angle)?))
    }

    pub fn try_map(&self, map_fn: impl Fn(f32) -> f32) -> Option<Self>
    where
        D: css::generic::TryMap,
    {
        match self {
            Self::Dimension(vv) => css::generic::try_map(vv, map_fn).map(Self::Dimension),
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
        D: css::generic::TryOp,
    {
        match (self, other) {
            (Self::Dimension(a), Self::Dimension(b)) => {
                Some(Self::Dimension(css::generic::try_op(a, b, ctx, &op_fn)?))
            }
            (Self::Percentage(a), Self::Percentage(b)) => {
                Some(Self::Percentage(Percentage {
                    v: op_fn(ctx, a.v, b.v),
                }))
            }
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
    // TODO: implement this
    // TODO(port): Zig used `css.DeriveParse(@This()).parse` / `css.DeriveToCss(@This()).toCss`
    // (comptime reflection derives). Phase B: implement via #[derive(Parse, ToCss)] proc-macro
    // or hand-roll the two-variant try-parse cascade.
    pub fn parse(input: &mut css::Parser) -> CssResult<NumberOrPercentage> {
        // TODO(port): proc-macro — DeriveParse
        let _ = input;
        unimplemented!("css.DeriveParse")
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // TODO(port): proc-macro — DeriveToCss
        let _ = dest;
        unimplemented!("css.DeriveToCss")
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

    pub fn eql(&self, other: &NumberOrPercentage) -> bool {
        // PORT NOTE: Zig used css.implementEql (reflection) → #[derive(PartialEq)].
        self == other
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/values/percentage.zig (473 lines)
//   confidence: medium
//   todos:      11
//   notes:      LIFETIMES.tsv→Box for calc field; css is arena crate so PERF(port) markers added. add_recursive Sum-arm ownership needs review (Zig aliased raw ptrs, Rust deep-clones). D-type comptime switches (f32 special-case, needs_deepclone) folded into trait bounds.
// ──────────────────────────────────────────────────────────────────────────
