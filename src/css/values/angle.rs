use crate as css;
use crate::Result;
use crate::Printer;
use crate::PrintErr;
use crate::css_values::number::{CSSNumber, CSSNumberFns};
use crate::css_values::calc::Calc;
use crate::css_values::percentage::DimensionPercentage;

use bun_alloc::Arena; // bumpalo::Bump re-export (CSS is an AST crate)
use bun_str::strings;
use bun_wyhash::Wyhash;
use core::cmp::Ordering;

const TAG_DEG: u8 = 1;
const TAG_RAD: u8 = 2;
const TAG_GRAD: u8 = 4;
const TAG_TURN: u8 = 8;

/// A CSS [`<angle>`](https://www.w3.org/TR/css-values-4/#angles) value.
///
/// Angles may be explicit or computed by `calc()`, but are always stored and serialized
/// as their computed value.
#[repr(u8)]
#[derive(Clone, Copy)]
pub enum Angle {
    /// An angle in degrees. There are 360 degrees in a full circle.
    Deg(CSSNumber) = TAG_DEG,
    /// An angle in radians. There are 2π radians in a full circle.
    Rad(CSSNumber) = TAG_RAD,
    /// An angle in gradians. There are 400 gradians in a full circle.
    Grad(CSSNumber) = TAG_GRAD,
    /// An angle in turns. There is 1 turn in a full circle.
    Turn(CSSNumber) = TAG_TURN,
}

impl Angle {
    // ~toCssImpl

    #[inline]
    fn tag(&self) -> u8 {
        match self {
            Angle::Deg(_) => TAG_DEG,
            Angle::Rad(_) => TAG_RAD,
            Angle::Grad(_) => TAG_GRAD,
            Angle::Turn(_) => TAG_TURN,
        }
    }

    pub fn parse(input: &mut css::Parser) -> Result<Angle> {
        Angle::parse_internal(input, false)
    }

    fn parse_internal(input: &mut css::Parser, allow_unitless_zero: bool) -> Result<Angle> {
        if let Some(calc_value) = input.try_parse(Calc::<Angle>::parse, ()).as_value() {
            if let Calc::Value(value) = calc_value {
                return Result::Ok(*value);
            }
            // Angles are always compatible, so they will always compute to a value.
            return Result::Err(input.new_custom_error(css::ParserError::InvalidValue));
        }

        let location = input.current_source_location();
        let token = match input.next() {
            Result::Ok(vv) => vv,
            Result::Err(e) => return Result::Err(e),
        };
        match &*token {
            css::Token::Dimension(dim) => {
                let value = dim.num.value;
                let unit = dim.unit;
                // todo_stuff.match_ignore_ascii_case
                if strings::eql_case_insensitive_ascii_check_length(b"deg", unit) {
                    return Result::Ok(Angle::Deg(value));
                } else if strings::eql_case_insensitive_ascii_check_length(b"grad", unit) {
                    return Result::Ok(Angle::Grad(value));
                } else if strings::eql_case_insensitive_ascii_check_length(b"turn", unit) {
                    return Result::Ok(Angle::Turn(value));
                } else if strings::eql_case_insensitive_ascii_check_length(b"rad", unit) {
                    return Result::Ok(Angle::Rad(value));
                } else {
                    return Result::Err(location.new_unexpected_token_error(token.clone()));
                }
            }
            css::Token::Number(num) => {
                if num.value == 0.0 && allow_unitless_zero {
                    return Result::Ok(Angle::zero());
                }
            }
            _ => {}
        }
        Result::Err(location.new_unexpected_token_error(token.clone()))
    }

    pub fn parse_with_unitless_zero(input: &mut css::Parser) -> Result<Angle> {
        Angle::parse_internal(input, true)
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        let (value, unit): (f32, &'static str) = match *self {
            Angle::Deg(val) => (val, "deg"),
            Angle::Grad(val) => (val, "grad"),
            Angle::Rad(val) => 'brk: {
                let deg = self.to_degrees();

                // We print 5 digits of precision by default.
                // Switch to degrees if length is smaller than rad.
                if css::f32_length_with_5_digits(deg) < css::f32_length_with_5_digits(val) {
                    break 'brk (deg, "deg");
                } else {
                    break 'brk (val, "rad");
                }
            }
            Angle::Turn(val) => (val, "turn"),
        };
        match css::serializer::serialize_dimension(value, unit, dest) {
            Ok(()) => Ok(()),
            Err(_) => dest.add_fmt_error(),
        }
    }

    pub fn to_css_with_unitless_zero(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        if self.is_zero() {
            let v: f32 = 0.0;
            CSSNumberFns::to_css(&v, dest)
        } else {
            self.to_css(dest)
        }
    }

    pub fn try_from_angle(angle: Angle) -> Option<Self> {
        Some(angle)
    }

    pub fn try_from_token(token: &css::Token) -> css::Maybe<Angle, ()> {
        if let css::Token::Dimension(dimension) = token {
            let value = dimension.num.value;
            let unit = dimension.unit;
            if strings::eql_case_insensitive_ascii_check_length(unit, b"deg") {
                return css::Maybe::Ok(Angle::Deg(value));
            } else if strings::eql_case_insensitive_ascii_check_length(unit, b"grad") {
                return css::Maybe::Ok(Angle::Grad(value));
            } else if strings::eql_case_insensitive_ascii_check_length(unit, b"turn") {
                return css::Maybe::Ok(Angle::Turn(value));
            } else if strings::eql_case_insensitive_ascii_check_length(unit, b"rad") {
                return css::Maybe::Ok(Angle::Rad(value));
            }
        }
        css::Maybe::Err(())
    }

    /// Returns the angle in radians.
    pub fn to_radians(&self) -> CSSNumber {
        const RAD_PER_DEG: f32 = core::f32::consts::PI / 180.0;
        match *self {
            Angle::Deg(deg) => deg * RAD_PER_DEG,
            Angle::Rad(rad) => rad,
            Angle::Grad(grad) => grad * 180.0 / 200.0 * RAD_PER_DEG,
            Angle::Turn(turn) => turn * 360.0 * RAD_PER_DEG,
        }
    }

    /// Returns the angle in degrees.
    pub fn to_degrees(&self) -> CSSNumber {
        const DEG_PER_RAD: f32 = 180.0 / core::f32::consts::PI;
        match *self {
            Angle::Deg(deg) => deg,
            Angle::Rad(rad) => rad * DEG_PER_RAD,
            Angle::Grad(grad) => grad * 180.0 / 200.0,
            Angle::Turn(turn) => turn * 360.0,
        }
    }

    pub fn zero() -> Angle {
        Angle::Deg(0.0)
    }

    pub fn is_zero(&self) -> bool {
        let v = match *self {
            Angle::Deg(deg) => deg,
            Angle::Rad(rad) => rad,
            Angle::Grad(grad) => grad,
            Angle::Turn(turn) => turn,
        };
        v == 0.0
    }

    pub fn into_calc<'bump>(&self, bump: &'bump Arena) -> Calc<'bump, Angle> {
        // TODO(port): Calc::Value payload is arena-allocated in CSS crate; verify Calc<'bump, T> shape in Phase B
        Calc::Value(bump.alloc(*self))
    }

    pub fn map(&self, opfn: impl Fn(f32) -> f32) -> Angle {
        match *self {
            Angle::Deg(deg) => Angle::Deg(opfn(deg)),
            Angle::Rad(rad) => Angle::Rad(opfn(rad)),
            Angle::Grad(grad) => Angle::Grad(opfn(grad)),
            Angle::Turn(turn) => Angle::Turn(opfn(turn)),
        }
    }

    pub fn try_map(&self, opfn: impl Fn(f32) -> f32) -> Option<Angle> {
        Some(self.map(opfn))
    }

    pub fn add_internal(self, other: Angle) -> Angle {
        self.add(other)
    }

    pub fn add(self, rhs: Angle) -> Angle {
        Angle::op(&self, &rhs, (), |_: (), a: f32, b: f32| a + b)
    }

    pub fn try_add(&self, rhs: &Angle) -> Option<Angle> {
        Some(Angle::Deg(self.to_degrees() + rhs.to_degrees()))
    }

    pub fn eql(lhs: &Angle, rhs: &Angle) -> bool {
        lhs.to_degrees() == rhs.to_degrees()
    }

    pub fn mul_f32(self, other: f32) -> Angle {
        // return Angle.op(&this, &other, Angle.mulF32);
        match self {
            Angle::Deg(v) => Angle::Deg(v * other),
            Angle::Rad(v) => Angle::Rad(v * other),
            Angle::Grad(v) => Angle::Grad(v * other),
            Angle::Turn(v) => Angle::Turn(v * other),
        }
    }

    pub fn partial_cmp(&self, other: &Angle) -> Option<Ordering> {
        css::generic::partial_cmp_f32(&self.to_degrees(), &other.to_degrees())
    }

    pub fn try_op<C>(
        &self,
        other: &Angle,
        ctx: C,
        op_fn: fn(C, f32, f32) -> f32,
    ) -> Option<Angle> {
        Some(Angle::op(self, other, ctx, op_fn))
    }

    pub fn try_op_to<R, C>(
        &self,
        other: &Angle,
        ctx: C,
        op_fn: fn(C, f32, f32) -> R,
    ) -> Option<R> {
        Some(Angle::op_to(self, other, ctx, op_fn))
    }

    pub fn op<C>(
        &self,
        other: &Angle,
        ctx: C,
        op_fn: fn(C, f32, f32) -> f32,
    ) -> Angle {
        // PERF: not sure if this is faster
        // PORT NOTE: reshaped for borrowck — Zig used packed-tag bit-twiddling switch; Rust match on (tag, tag) is equivalent.
        match (self, other) {
            (Angle::Deg(a), Angle::Deg(b)) => Angle::Deg(op_fn(ctx, *a, *b)),
            (Angle::Rad(a), Angle::Rad(b)) => Angle::Rad(op_fn(ctx, *a, *b)),
            (Angle::Grad(a), Angle::Grad(b)) => Angle::Grad(op_fn(ctx, *a, *b)),
            (Angle::Turn(a), Angle::Turn(b)) => Angle::Turn(op_fn(ctx, *a, *b)),
            _ => Angle::Deg(op_fn(ctx, self.to_degrees(), other.to_degrees())),
        }
        // PERF(port): was comptime monomorphization (fn-ptr arg) — profile in Phase B
    }

    pub fn op_to<T, C>(
        &self,
        other: &Angle,
        ctx: C,
        op_fn: fn(C, f32, f32) -> T,
    ) -> T {
        // PERF: not sure if this is faster
        // TODO(port): upstream bug — Zig `opTo` computes `other_tag` from `this.*`, so mixed-variant
        // inputs read `other`'s raw f32 payload via the wrong arm. This port INTENTIONALLY DIVERGES:
        // we require both operands to share a variant, otherwise fall through to to_degrees().
        // Revisit in Phase B and fix upstream.
        match (self, other) {
            (Angle::Deg(a), Angle::Deg(b)) => op_fn(ctx, *a, *b),
            (Angle::Rad(a), Angle::Rad(b)) => op_fn(ctx, *a, *b),
            (Angle::Grad(a), Angle::Grad(b)) => op_fn(ctx, *a, *b),
            (Angle::Turn(a), Angle::Turn(b)) => op_fn(ctx, *a, *b),
            _ => op_fn(ctx, self.to_degrees(), other.to_degrees()),
        }
        // PERF(port): was comptime monomorphization (fn-ptr arg) — profile in Phase B
    }

    pub fn sign(&self) -> f32 {
        match *self {
            Angle::Deg(v) | Angle::Rad(v) | Angle::Grad(v) | Angle::Turn(v) => {
                CSSNumberFns::sign(&v)
            }
        }
    }

    pub fn hash(&self, hasher: &mut Wyhash) {
        css::implement_hash(self, hasher)
    }

    pub fn deep_clone<'bump>(&self, bump: &'bump Arena) -> Self {
        css::implement_deep_clone(self, bump)
    }
}

/// A CSS [`<angle-percentage>`](https://www.w3.org/TR/css-values-4/#typedef-angle-percentage) value.
/// May be specified as either an angle or a percentage that resolves to an angle.
pub type AnglePercentage = DimensionPercentage<Angle>;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/values/angle.zig (306 lines)
//   confidence: medium
//   todos:      2
//   notes:      op_to intentionally diverges from upstream Zig bug (other_tag reads from `this`); Calc<'bump,T> shape and css::Result/Maybe variants need Phase B verification
// ──────────────────────────────────────────────────────────────────────────
