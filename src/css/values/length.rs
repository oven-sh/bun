use crate::compat::Feature;
use crate::css_parser as css;
use crate::css_parser::{CssResult, Maybe, Parser, PrintErr, Printer, Token};
use crate::targets::Browsers;
use crate::values::angle::Angle;
use crate::values::calc::{Calc, MathFunction};
use crate::values::number::CSSNumber;
use crate::values::percentage::DimensionPercentage;
use crate::values::protocol;

use core::cmp::Ordering;

/// Either a [`<length>`](https://www.w3.org/TR/css-values-4/#lengths) or a [`<number>`](https://www.w3.org/TR/css-values-4/#numbers).
#[derive(Clone, PartialEq, css::Parse, css::ToCss)]
pub enum LengthOrNumber {
    /// A number.
    Number(CSSNumber),
    /// A length.
    Length(Length),
}

impl LengthOrNumber {
    // parse + to_css — provided by #[derive(css::Parse, css::ToCss)]
    // (f32 resolves via generics::{Parse,ToCss} for f32). is_compatible KEPT.

    pub(crate) fn is_compatible(&self, browsers: &Browsers) -> bool {
        match self {
            Self::Length(l) => l.is_compatible(browsers),
            Self::Number(_) => true,
        }
    }
}

impl Default for LengthOrNumber {
    fn default() -> Self {
        Self::Number(0.0)
    }
}

pub(crate) type LengthPercentage = DimensionPercentage<LengthValue>;

/// Either a [`<length-percentage>`](https://www.w3.org/TR/css-values-4/#typedef-length-percentage), or the `auto` keyword.
#[derive(Clone, PartialEq, css::Parse, css::ToCss)]
pub enum LengthPercentageOrAuto {
    /// The `auto` keyword.
    Auto,
    /// A [`<length-percentage>`](https://www.w3.org/TR/css-values-4/#typedef-length-percentage).
    Length(LengthPercentage),
}

impl LengthPercentageOrAuto {
    // parse + to_css — provided by #[derive(css::Parse, css::ToCss)]. is_compatible KEPT.

    pub(crate) fn is_compatible(&self, browsers: &Browsers) -> bool {
        match self {
            Self::Length(l) => l.is_compatible(browsers),
            _ => true,
        }
    }
}

const PX_PER_IN: f32 = 96.0;
const PX_PER_CM: f32 = PX_PER_IN / 2.54;
const PX_PER_MM: f32 = PX_PER_CM / 10.0;
const PX_PER_Q: f32 = PX_PER_CM / 40.0;
const PX_PER_PT: f32 = PX_PER_IN / 72.0;
const PX_PER_PC: f32 = PX_PER_IN / 6.0;

// ──────────────────────────────────────────────────────────────────────────
// LengthValue
//
// An enum with ~50 variants, each carrying a single `CSSNumber` (f32).
//
// Per PORTING.md §"Comptime reflection": >8 variants → small macro generator.
// `define_length_units!` generates the enum plus the handful of per-variant
// dispatch helpers (`value()`, `unit()`, `from_unit_ci()`, `map_value()`,
// `try_same_unit_op()`, `feature()`); all higher-level methods are then written
// in terms of those.
// ──────────────────────────────────────────────────────────────────────────

macro_rules! define_length_units {
    (
        $(
            $(#[$doc:meta])*
            $variant:ident : $unit:literal => $feature:expr
        ),* $(,)?
    ) => {
        #[derive(Clone, Copy, Debug, crate::generics::CssEql, crate::generics::CssHash, crate::generics::DeepClone)]
        pub enum LengthValue {
            $(
                $(#[$doc])*
                $variant(CSSNumber),
            )*
        }

        impl LengthValue {
            /// Returns the inner numeric value regardless of unit.
            #[inline]
            fn value(&self) -> CSSNumber {
                match self { $( Self::$variant(v) => *v, )* }
            }

            /// Returns the canonical lowercase unit name.
            #[inline]
            fn unit(&self) -> &'static [u8] {
                match self { $( Self::$variant(_) => $unit, )* }
            }

            /// Case-insensitive ASCII unit lookup (mirrors `eqlCaseInsensitiveASCIIICheckLength`).
            #[inline]
            fn from_unit_ci(unit: &[u8], value: CSSNumber) -> Option<Self> {
                crate::match_ignore_ascii_case! { unit, {
                    $( $unit => Some(Self::$variant(value)), )*
                    _ => None,
                }}
            }

            /// Apply `f` to the inner value, preserving the variant.
            #[inline]
            fn map_value(&self, f: impl FnOnce(f32) -> f32) -> Self {
                match self { $( Self::$variant(v) => Self::$variant(f(*v)), )* }
            }

            /// If `self` and `other` are the same unit, apply `f(a, b)` and return
            /// the result in that unit; else `None`.
            #[inline]
            fn try_same_unit_op(&self, other: &Self, f: impl Fn(f32, f32) -> f32) -> Option<Self> {
                match (self, other) {
                    $( (Self::$variant(a), Self::$variant(b)) => Some(Self::$variant(f(*a, *b))), )*
                    _ => None,
                }
            }

            /// Compat-feature gate for this unit.
            #[inline]
            fn feature(&self) -> Option<Feature> {
                match self { $( Self::$variant(_) => $feature, )* }
            }
        }
    };
}

define_length_units! {
    // https://www.w3.org/TR/css-values-4/#absolute-lengths
    /// A length in pixels.
    Px: b"px" => None,
    /// A length in inches. 1in = 96px.
    In: b"in" => None,
    /// A length in centimeters. 1cm = 96px / 2.54.
    Cm: b"cm" => None,
    /// A length in millimeters. 1mm = 1/10th of 1cm.
    Mm: b"mm" => None,
    /// A length in quarter-millimeters. 1Q = 1/40th of 1cm.
    Q: b"q" => Some(Feature::QUnit),
    /// A length in points. 1pt = 1/72nd of 1in.
    Pt: b"pt" => None,
    /// A length in picas. 1pc = 1/6th of 1in.
    Pc: b"pc" => None,

    // https://www.w3.org/TR/css-values-4/#font-relative-lengths
    /// A length in the `em` unit. An `em` is equal to the computed value of the
    /// font-size property of the element on which it is used.
    Em: b"em" => None,
    /// A length in the `rem` unit. A `rem` is equal to the computed value of the
    /// `em` unit on the root element.
    Rem: b"rem" => Some(Feature::RemUnit),
    /// A length in `ex` unit. An `ex` is equal to the x-height of the font.
    Ex: b"ex" => Some(Feature::ExUnit),
    /// A length in the `rex` unit. A `rex` is equal to the value of the `ex` unit on the root element.
    Rex: b"rex" => None,
    /// A length in the `ch` unit. A `ch` is equal to the width of the zero ("0") character in the current font.
    Ch: b"ch" => Some(Feature::ChUnit),
    /// A length in the `rch` unit. An `rch` is equal to the value of the `ch` unit on the root element.
    Rch: b"rch" => None,
    /// A length in the `cap` unit. A `cap` is equal to the cap-height of the font.
    Cap: b"cap" => Some(Feature::CapUnit),
    /// A length in the `rcap` unit. An `rcap` is equal to the value of the `cap` unit on the root element.
    Rcap: b"rcap" => None,
    /// A length in the `ic` unit. An `ic` is equal to the width of the "水" (CJK water ideograph) character in the current font.
    Ic: b"ic" => Some(Feature::IcUnit),
    /// A length in the `ric` unit. An `ric` is equal to the value of the `ic` unit on the root element.
    Ric: b"ric" => None,
    /// A length in the `lh` unit. An `lh` is equal to the computed value of the `line-height` property.
    Lh: b"lh" => Some(Feature::LhUnit),
    /// A length in the `rlh` unit. An `rlh` is equal to the value of the `lh` unit on the root element.
    Rlh: b"rlh" => Some(Feature::RlhUnit),

    // https://www.w3.org/TR/css-values-4/#viewport-relative-units
    /// A length in the `vw` unit. A `vw` is equal to 1% of the [viewport width](https://www.w3.org/TR/css-values-4/#ua-default-viewport-size).
    Vw: b"vw" => Some(Feature::VwUnit),
    /// A length in the `lvw` unit. An `lvw` is equal to 1% of the [large viewport width](https://www.w3.org/TR/css-values-4/#large-viewport-size).
    Lvw: b"lvw" => Some(Feature::ViewportPercentageUnitsLarge),
    /// A length in the `svw` unit. An `svw` is equal to 1% of the [small viewport width](https://www.w3.org/TR/css-values-4/#small-viewport-size).
    Svw: b"svw" => Some(Feature::ViewportPercentageUnitsSmall),
    /// A length in the `dvw` unit. An `dvw` is equal to 1% of the [dynamic viewport width](https://www.w3.org/TR/css-values-4/#dynamic-viewport-size).
    Dvw: b"dvw" => Some(Feature::ViewportPercentageUnitsDynamic),
    /// A length in the `cqw` unit. An `cqw` is equal to 1% of the [query container](https://drafts.csswg.org/css-contain-3/#query-container) width.
    Cqw: b"cqw" => Some(Feature::ContainerQueryLengthUnits),

    /// A length in the `vh` unit. A `vh` is equal to 1% of the [viewport height](https://www.w3.org/TR/css-values-4/#ua-default-viewport-size).
    Vh: b"vh" => Some(Feature::VhUnit),
    /// A length in the `lvh` unit. An `lvh` is equal to 1% of the [large viewport height](https://www.w3.org/TR/css-values-4/#large-viewport-size).
    Lvh: b"lvh" => Some(Feature::ViewportPercentageUnitsLarge),
    /// A length in the `svh` unit. An `svh` is equal to 1% of the [small viewport height](https://www.w3.org/TR/css-values-4/#small-viewport-size).
    Svh: b"svh" => Some(Feature::ViewportPercentageUnitsSmall),
    /// A length in the `dvh` unit. An `dvh` is equal to 1% of the [dynamic viewport height](https://www.w3.org/TR/css-values-4/#dynamic-viewport-size).
    Dvh: b"dvh" => Some(Feature::ViewportPercentageUnitsDynamic),
    /// A length in the `cqh` unit. An `cqh` is equal to 1% of the [query container](https://drafts.csswg.org/css-contain-3/#query-container) height.
    Cqh: b"cqh" => Some(Feature::ContainerQueryLengthUnits),

    /// A length in the `vi` unit. A `vi` is equal to 1% of the [viewport size](https://www.w3.org/TR/css-values-4/#ua-default-viewport-size)
    /// in the box's [inline axis](https://www.w3.org/TR/css-writing-modes-4/#inline-axis).
    Vi: b"vi" => Some(Feature::ViUnit),
    /// A length in the `svi` unit. A `svi` is equal to 1% of the [small viewport size](https://www.w3.org/TR/css-values-4/#small-viewport-size)
    /// in the box's [inline axis](https://www.w3.org/TR/css-writing-modes-4/#inline-axis).
    Svi: b"svi" => Some(Feature::ViewportPercentageUnitsSmall),
    /// A length in the `lvi` unit. A `lvi` is equal to 1% of the [large viewport size](https://www.w3.org/TR/css-values-4/#large-viewport-size)
    /// in the box's [inline axis](https://www.w3.org/TR/css-writing-modes-4/#inline-axis).
    Lvi: b"lvi" => Some(Feature::ViewportPercentageUnitsLarge),
    /// A length in the `dvi` unit. A `dvi` is equal to 1% of the [dynamic viewport size](https://www.w3.org/TR/css-values-4/#dynamic-viewport-size)
    /// in the box's [inline axis](https://www.w3.org/TR/css-writing-modes-4/#inline-axis).
    Dvi: b"dvi" => Some(Feature::ViewportPercentageUnitsDynamic),
    /// A length in the `cqi` unit. An `cqi` is equal to 1% of the [query container](https://drafts.csswg.org/css-contain-3/#query-container) inline size.
    Cqi: b"cqi" => Some(Feature::ContainerQueryLengthUnits),

    /// A length in the `vb` unit. A `vb` is equal to 1% of the [viewport size](https://www.w3.org/TR/css-values-4/#ua-default-viewport-size)
    /// in the box's [block axis](https://www.w3.org/TR/css-writing-modes-4/#block-axis).
    Vb: b"vb" => Some(Feature::VbUnit),
    /// A length in the `svb` unit. A `svb` is equal to 1% of the [small viewport size](https://www.w3.org/TR/css-values-4/#small-viewport-size)
    /// in the box's [block axis](https://www.w3.org/TR/css-writing-modes-4/#block-axis).
    Svb: b"svb" => Some(Feature::ViewportPercentageUnitsSmall),
    /// A length in the `lvb` unit. A `lvb` is equal to 1% of the [large viewport size](https://www.w3.org/TR/css-values-4/#large-viewport-size)
    /// in the box's [block axis](https://www.w3.org/TR/css-writing-modes-4/#block-axis).
    Lvb: b"lvb" => Some(Feature::ViewportPercentageUnitsLarge),
    /// A length in the `dvb` unit. A `dvb` is equal to 1% of the [dynamic viewport size](https://www.w3.org/TR/css-values-4/#dynamic-viewport-size)
    /// in the box's [block axis](https://www.w3.org/TR/css-writing-modes-4/#block-axis).
    Dvb: b"dvb" => Some(Feature::ViewportPercentageUnitsDynamic),
    /// A length in the `cqb` unit. An `cqb` is equal to 1% of the [query container](https://drafts.csswg.org/css-contain-3/#query-container) block size.
    Cqb: b"cqb" => Some(Feature::ContainerQueryLengthUnits),

    /// A length in the `vmin` unit. A `vmin` is equal to the smaller of `vw` and `vh`.
    Vmin: b"vmin" => Some(Feature::VminUnit),
    /// A length in the `svmin` unit. An `svmin` is equal to the smaller of `svw` and `svh`.
    Svmin: b"svmin" => Some(Feature::ViewportPercentageUnitsSmall),
    /// A length in the `lvmin` unit. An `lvmin` is equal to the smaller of `lvw` and `lvh`.
    Lvmin: b"lvmin" => Some(Feature::ViewportPercentageUnitsLarge),
    /// A length in the `dvmin` unit. An `dvmin` is equal to the smaller of `dvw` and `dvh`.
    Dvmin: b"dvmin" => Some(Feature::ViewportPercentageUnitsDynamic),
    /// A length in the `cqmin` unit. An `cqmin` is equal to the smaller of `cqi` and `cqb`.
    Cqmin: b"cqmin" => Some(Feature::ContainerQueryLengthUnits),

    /// A length in the `vmax` unit. A `vmax` is equal to the larger of `vw` and `vh`.
    Vmax: b"vmax" => Some(Feature::VmaxUnit),
    /// A length in the `svmax` unit. An `svmax` is equal to the larger of `svw` and `svh`.
    Svmax: b"svmax" => Some(Feature::ViewportPercentageUnitsSmall),
    /// A length in the `lvmax` unit. An `lvmax` is equal to the larger of `lvw` and `lvh`.
    Lvmax: b"lvmax" => Some(Feature::ViewportPercentageUnitsLarge),
    /// A length in the `dvmax` unit. An `dvmax` is equal to the larger of `dvw` and `dvh`.
    Dvmax: b"dvmax" => Some(Feature::ViewportPercentageUnitsDynamic),
    /// A length in the `cqmax` unit. An `cqmin` is equal to the larger of `cqi` and `cqb`.
    Cqmax: b"cqmax" => Some(Feature::ContainerQueryLengthUnits),
}

// The macro above guarantees feature coverage of every variant by
// construction (one `=> $feature` per variant), so no separate assert needed.

impl LengthValue {
    pub(crate) fn parse(input: &mut Parser) -> CssResult<Self> {
        let location = input.current_source_location();
        let token = *input.next()?;
        match &token {
            Token::Dimension(dim) => {
                if let Some(v) = Self::from_unit_ci(dim.unit, dim.num.value) {
                    return Ok(v);
                }
            }
            Token::Number(num) => return Ok(Self::Px(num.value)),
            _ => {}
        }
        Err(location.new_unexpected_token_error(token))
    }

    pub(crate) fn to_css(self, dest: &mut Printer) -> Result<(), PrintErr> {
        let (value, unit) = self.to_unit_value();

        // The unit can be omitted if the value is zero, except inside calc()
        // expressions, where unitless numbers won't be parsed as dimensions.
        if !dest.in_calc && value == 0.0 {
            return dest.write_char(b'0');
        }

        css::serializer::serialize_dimension(value, unit, dest)
    }

    pub(crate) fn is_zero(self) -> bool {
        self.value() == 0.0
    }

    // deep_clone / eql / hash — provided by `#[derive(DeepClone, CssEql, CssHash)]`
    // on the macro-generated enum (POD f32 payload → bitwise/structural).

    pub(crate) fn zero() -> LengthValue {
        Self::Px(0.0)
    }

    /// Attempts to convert the value to pixels.
    /// Returns `None` if the conversion is not possible.
    pub(crate) fn to_px(self) -> Option<CSSNumber> {
        match self {
            Self::Px(v) => Some(v),
            Self::In(v) => Some(v * PX_PER_IN),
            Self::Cm(v) => Some(v * PX_PER_CM),
            Self::Mm(v) => Some(v * PX_PER_MM),
            Self::Q(v) => Some(v * PX_PER_Q),
            Self::Pt(v) => Some(v * PX_PER_PT),
            Self::Pc(v) => Some(v * PX_PER_PC),
            _ => None,
        }
    }

    /// How many 1/381 px one of this unit is. 1in = 96px, 1pt = 4/3 px and 1cm = 4800/127 px,
    /// so this is a whole number for every absolute unit. The px value is not: 1pt is 1.3333334px.
    fn px381_per_unit(self) -> Option<u64> {
        Some(match self {
            Self::Px(_) => 381,
            Self::In(_) => 36576,
            Self::Cm(_) => 14400,
            Self::Mm(_) => 1440,
            Self::Q(_) => 360,
            Self::Pt(_) => 508,
            Self::Pc(_) => 6096,
            _ => return None,
        })
    }

    /// The operands for a math function over two absolute lengths in different units, and the
    /// factor that takes its result to px. `None` keeps the function as written.
    ///
    /// round(), rem() and mod() jump where the quotient of their operands crosses a whole number
    /// (round() also a half). `to_px` rounds each operand, so `mod(4px, 1pt)` on px values is
    /// 1.33333px, not 0. The operands here are whole numbers of one common unit, divided by
    /// their greatest common divisor: f32 holds them, and their quotient rounds to the right
    /// side of every jump.
    #[cold]
    #[inline(never)]
    fn mixed_unit_operands(self, rhs: Self) -> Option<(f32, f32, f64)> {
        let (kx, ky) = (self.px381_per_unit()?, rhs.px381_per_unit()?);
        let (x, y) = (self.value(), rhs.value());

        // `Some` when both operands are known exactly but do not fit f32: are they on a jump?
        let mut exact_on_jump = None;
        if let (Some((mx, dx)), Some((my, dy))) = (short_decimal(x.abs()), short_decimal(y.abs())) {
            // Both in 1/(381 * 10^d) px, and below 2^24 * 10^6 * 36576 < 2^60.
            let d = dx.max(dy);
            let a = mx * POW10[d - dx] * kx;
            let b = my * POW10[d - dy] * ky;
            let g = gcd(a, b).max(1);
            let (ra, rb) = (a / g, b / g);
            // With a below 2^23, a quotient that is not a multiple of 1/2 is further from one
            // than the f32 division rounds.
            if ra < (1 << 23) && rb < (1 << 24) {
                let to_px = g as f64 / (381 * POW10[d]) as f64;
                return Some(((ra as f32).copysign(x), (rb as f32).copysign(y), to_px));
            }
            exact_on_jump = Some((2 * a).checked_rem(b) == Some(0));
        }

        let (a, b) = (x * kx as f32, y * ky as f32);
        if !(a.is_finite() && b.is_finite()) {
            return Some((self.to_px()?, rhs.to_px()?, 1.0));
        }
        // The distance of `2a / b` from a whole number, against two roundings for each operand:
        // the literal to f32, and the product above.
        let r = ((a + a) % b).abs();
        let near_jump = r.min(b.abs() - r) <= (a + a).abs() * (2.0 * f32::EPSILON);
        let keep = match exact_on_jump {
            // Rounded operands are trusted only where they are clear of every jump.
            Some(on_jump) => on_jump || r == 0.0 || near_jump,
            // Operands that f32 puts exactly on a jump are taken to be on it.
            None => r > 0.0 && near_jump,
        };
        (!keep).then_some((a, b, 1.0 / 381.0))
    }

    /// `f` over two lengths in different units, in px. Valid for an `f` that scales with its
    /// operands, `f(k * a, k * b) == k * f(a, b)`: round, rem, mod and hypot do.
    #[cold]
    #[inline(never)]
    fn try_op_mixed_units<C>(
        self,
        rhs: Self,
        ctx: C,
        f: impl Fn(C, f32, f32) -> f32,
    ) -> Option<Self> {
        let (a, b, to_px) = self.mixed_unit_operands(rhs)?;
        let v = f(ctx, a, b);
        // A result that is one of the operands gets the px value `to_px` gives that length
        // everywhere else, so `calc(round(3cm, 1mm) - 3cm)` is 0 to the last bit.
        let px = if v == a {
            self.to_px()?
        } else if v == b {
            rhs.to_px()?
        } else {
            (f64::from(v) * to_px) as f32
        };
        Some(Self::Px(px))
    }

    fn try_sign(self) -> Option<f32> {
        Some(self.sign())
    }

    fn sign(self) -> f32 {
        css::signfns::sign_f32(self.value())
    }

    pub(crate) fn try_from_token(token: &Token) -> Maybe<Self, ()> {
        match token {
            Token::Dimension(dim) => {
                if let Some(v) = Self::from_unit_ci(dim.unit, dim.num.value) {
                    return Ok(v);
                }
            }
            _ => {}
        }
        Err(())
    }

    pub(crate) fn to_unit_value(self) -> (CSSNumber, &'static [u8]) {
        (self.value(), self.unit())
    }

    fn map(self, map_fn: impl FnOnce(f32) -> f32) -> LengthValue {
        self.map_value(map_fn)
    }

    fn mul_f32(self, other: f32) -> LengthValue {
        self.map_value(|v| v * other)
    }

    fn partial_cmp(self, other: LengthValue) -> Option<Ordering> {
        if core::mem::discriminant(&self) == core::mem::discriminant(&other) {
            let a = self.value();
            let b = other.value();
            return crate::generic::partial_cmp_f32(a, b);
        }

        let a = self.to_px();
        let b = other.to_px();
        if let (Some(a), Some(b)) = (a, b) {
            return crate::generic::partial_cmp_f32(a, b);
        }
        None
    }

    fn try_add(self, rhs: LengthValue) -> Option<LengthValue> {
        if let Some(v) = self.try_same_unit_op(&rhs, |a, b| a + b) {
            return Some(v);
        }
        if let Some(a) = self.to_px() {
            if let Some(b) = rhs.to_px() {
                return Some(Self::Px(a + b));
            }
        }
        None
    }

    pub(crate) fn is_compatible(self, browsers: &Browsers) -> bool {
        match self.feature() {
            Some(feature) => feature.is_compatible(browsers),
            None => true,
        }
    }
}

const POW10: [u64; 7] = [1, 10, 100, 1_000, 10_000, 100_000, 1_000_000];

/// A non-negative `v` as the decimal `m / 10^k` it stands for: a whole number below 2^24, or
/// the f32 of a decimal with at most 6 significant digits. A literal that short survives f32
/// unchanged, and 6 digits is all the printer writes for a fraction.
fn short_decimal(v: f32) -> Option<(u64, usize)> {
    let x = f64::from(v);
    if x.is_nan() || x >= 16_777_216.0 {
        return None;
    }
    if x.fract() == 0.0 {
        return Some((x as u64, 0));
    }
    for k in 1..POW10.len() {
        let m = (x * POW10[k] as f64).round();
        if m > 999_999.0 {
            break;
        }
        if m >= 1.0 && (m / POW10[k] as f64) as f32 == v {
            return Some((m as u64, k));
        }
    }
    None
}

fn gcd(mut a: u64, mut b: u64) -> u64 {
    while b != 0 {
        (a, b) = (b, a % b);
    }
    a
}

impl PartialEq for LengthValue {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        // Same tag AND equal payload (f32 `==`).
        core::mem::discriminant(self) == core::mem::discriminant(other)
            && self.value() == other.value()
    }
}

/// A CSS [`<length>`](https://www.w3.org/TR/css-values-4/#lengths) value, with support for `calc()`.
#[derive(Clone, PartialEq, css::ToCss)]
pub enum Length {
    /// An explicitly specified length value.
    Value(LengthValue),
    /// A computed length value using `calc()`.
    Calc(Box<Calc<Length>>),
}

impl Length {
    pub(crate) fn zero() -> Length {
        Self::Value(LengthValue::zero())
    }

    pub(crate) fn deep_clone(&self) -> Length {
        // derive(Clone) on Box<Calc<Length>> already deep-clones.
        self.clone()
    }

    pub(crate) fn parse(input: &mut Parser) -> CssResult<Length> {
        if let Ok(calc_value) = input.try_parse(Calc::<Length>::parse) {
            // PERF: I don't like this redundant allocation
            if let Calc::Value(v) = calc_value {
                return Ok(*v);
            }
            return Ok(Self::Calc(Box::new(calc_value)));
        }

        let len = LengthValue::parse(input)?;
        Ok(Self::Value(len))
    }

    // to_css — provided by #[derive(css::ToCss)] (Box<Calc<Length>> auto-derefs
    // to Calc::<V: CalcValue>::to_css inherent). parse KEPT (custom Calc::Value unwrap).

    pub(crate) fn px(p: CSSNumber) -> Length {
        Self::Value(LengthValue::Px(p))
    }

    pub(crate) fn to_px(&self) -> Option<CSSNumber> {
        match self {
            Self::Value(a) => a.to_px(),
            _ => None,
        }
    }

    pub(crate) fn mul_f32(self, other: f32) -> Length {
        match self {
            Self::Value(v) => Self::Value(v.mul_f32(other)),
            Self::Calc(c) => Self::Calc(Box::new(c.mul_f32(other))),
        }
    }

    pub(crate) fn add(self, other: Length) -> Length {
        // Unwrap calc(...) functions so we can add inside.
        // Then wrap the result in a calc(...) again if necessary.
        let a = Self::unwrap_calc(self);
        let b = Self::unwrap_calc(other);
        let res = Length::add_internal(a, b);
        if let Self::Calc(c) = res {
            match *c {
                Calc::Value(v) => return *v,
                Calc::Function(f) if !matches!(*f, MathFunction::Calc(_)) => {
                    return Self::Calc(Box::new(Calc::Function(f)));
                }
                other => {
                    return Self::Calc(Box::new(Calc::Function(Box::new(MathFunction::Calc(
                        other,
                    )))));
                }
            }
        }
        res
    }

    pub(crate) fn add_internal(self, other: Length) -> Length {
        if let Some(r) = self.try_add(&other) {
            return r;
        }
        self.add__(other)
    }

    pub(crate) fn into_calc(self) -> Calc<Length> {
        match self {
            Self::Calc(c) => *c,
            v => Calc::Value(Box::new(v)),
        }
    }

    fn add__(self, other: Length) -> Length {
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
            (Self::Calc(ca), b) if matches!(*ca, Calc::Value(_)) && !matches!(b, Self::Calc(_)) => {
                let Calc::Value(v) = *ca else { unreachable!() };
                v.add__(b)
            }
            (a, Self::Calc(cb)) if matches!(*cb, Calc::Value(_)) && !matches!(a, Self::Calc(_)) => {
                let Calc::Value(v) = *cb else { unreachable!() };
                a.add__(*v)
            }
            (a, b) => Self::Calc(Box::new(Calc::Sum {
                left: Box::new(a.into_calc()),
                right: Box::new(b.into_calc()),
            })),
        }
        // For borrowck this needs
        // to move out of the Box, so the conditions are folded into match guards.
    }

    fn try_add(&self, other: &Length) -> Option<Length> {
        if let (Self::Value(a), Self::Value(b)) = (self, other) {
            if let Some(res) = a.try_add(*b) {
                return Some(Self::Value(res));
            }
            return None;
        }

        if let Self::Calc(c) = self {
            match &**c {
                Calc::Value(v) => return v.try_add(other),
                Calc::Sum { left, right } => {
                    let a = Self::Calc(left.clone());
                    if let Some(res) = a.try_add(other) {
                        return Some(res.add__(Self::Calc(right.clone())));
                    }

                    let b = Self::Calc(right.clone());
                    if let Some(res) = b.try_add(other) {
                        return Some(Self::Calc(left.clone()).add__(res));
                    }

                    return None;
                }
                _ => return None,
            }
            // `Box` ownership requires cloning the sub-nodes here (no aliasing
            // of the same heap node).
        }

        if let Self::Calc(c) = other {
            match &**c {
                Calc::Value(v) => return v.try_add(self),
                Calc::Sum { left, right } => {
                    let a = Self::Calc(left.clone());
                    if let Some(res) = self.try_add(&a) {
                        return Some(res.add__(Self::Calc(right.clone())));
                    }

                    let b = Self::Calc(right.clone());
                    if let Some(res) = self.try_add(&b) {
                        return Some(Self::Calc(left.clone()).add__(res));
                    }

                    return None;
                }
                _ => return None,
            }
        }

        None
    }

    fn unwrap_calc(length: Length) -> Length {
        match length {
            Self::Calc(c) => match *c {
                Calc::Function(f) => match *f {
                    MathFunction::Calc(c2) => Self::Calc(Box::new(c2)),
                    c2 => Self::Calc(Box::new(Calc::Function(Box::new(c2)))),
                },
                _ => Self::Calc(c),
            },
            _ => length,
        }
        // For borrowck, this moves out of the Box once and rebuilds.
    }

    pub(crate) fn try_sign(&self) -> Option<f32> {
        match self {
            Self::Value(v) => Some(v.sign()),
            Self::Calc(v) => v.try_sign(),
        }
    }

    fn is_sign_negative(&self) -> bool {
        let Some(s) = self.try_sign() else {
            return false;
        };
        s.is_sign_negative()
    }

    fn is_sign_positive(&self) -> bool {
        let Some(s) = self.try_sign() else {
            return false;
        };
        s.is_sign_positive()
    }

    pub(crate) fn partial_cmp(&self, other: &Length) -> Option<Ordering> {
        if let (Self::Value(a), Self::Value(b)) = (self, other) {
            return LengthValue::partial_cmp(*a, *b);
        }
        None
    }

    pub(crate) fn try_map(&self, map_fn: impl FnOnce(f32) -> f32) -> Option<Length> {
        match self {
            Self::Value(v) => Some(Self::Value(v.map(map_fn))),
            _ => None,
        }
    }

    fn is_zero(&self) -> bool {
        match self {
            Self::Value(v) => v.is_zero(),
            _ => false,
        }
    }

    pub(crate) fn is_compatible(&self, browsers: &Browsers) -> bool {
        match self {
            Self::Value(v) => v.is_compatible(browsers),
            Self::Calc(c) => c.is_compatible(browsers),
        }
    }
}

// ─── protocol-trait impls for the calc lattice ────────────────────────────
// These wire `LengthValue`/`Angle` into `DimensionPercentage<D>`'s bound set
// (`protocol::{Zero,MulF32,TryAdd,TrySign,TryMap,TryOp,PartialCmp,Parse,
// ToCss,IsCompatible}`). All forward to the inherent methods above.
impl protocol::Zero for LengthValue {
    #[inline]
    fn zero() -> Self {
        LengthValue::zero()
    }
    #[inline]
    fn is_zero(&self) -> bool {
        LengthValue::is_zero(*self)
    }
}
impl protocol::MulF32 for LengthValue {
    #[inline]
    fn mul_f32(self, rhs: f32) -> Self {
        LengthValue::mul_f32(self, rhs)
    }
}
impl protocol::TryAdd for LengthValue {
    #[inline]
    fn try_add(&self, rhs: &Self) -> Option<Self> {
        LengthValue::try_add(*self, *rhs)
    }
}
impl protocol::TryFromAngle for LengthValue {
    #[inline]
    fn try_from_angle(_: Angle) -> Option<Self> {
        None
    }
}
impl protocol::TrySign for LengthValue {
    #[inline]
    fn try_sign(&self) -> Option<f32> {
        LengthValue::try_sign(*self)
    }
}
impl protocol::TryMap for LengthValue {
    #[inline]
    fn try_map(&self, f: impl Fn(f32) -> f32) -> Option<Self> {
        Some(self.map_value(f))
    }
}
impl protocol::TryOp for LengthValue {
    #[inline]
    fn try_op<C>(&self, rhs: &Self, ctx: C, f: impl Fn(C, f32, f32) -> f32) -> Option<Self> {
        // `LengthValue::try_op` takes a 2-arg closure (ctx folded
        // in by caller); the `protocol::TryOp` shape passes `C` by-value with
        // no `Copy` bound, so we can't capture `ctx` in an `Fn` closure that
        // might be called more than once. Inline the same-unit + common-unit
        // dispatch here so `f` is invoked exactly once on the chosen path.
        if core::mem::discriminant(self) == core::mem::discriminant(rhs) {
            let v = f(ctx, self.value(), rhs.value());
            return Some(self.map_value(|_| v));
        }
        self.try_op_mixed_units(*rhs, ctx, f)
    }
}
impl protocol::TryOpTo for LengthValue {
    #[inline]
    fn try_op_to<R, C>(&self, rhs: &Self, ctx: C, f: impl Fn(C, f32, f32) -> R) -> Option<R> {
        if core::mem::discriminant(self) == core::mem::discriminant(rhs) {
            return Some(f(ctx, self.value(), rhs.value()));
        }
        if let (Some(a), Some(b)) = (self.to_px(), rhs.to_px()) {
            return Some(f(ctx, a, b));
        }
        None
    }
}
impl protocol::PartialCmp for LengthValue {
    #[inline]
    fn partial_cmp(&self, rhs: &Self) -> Option<Ordering> {
        LengthValue::partial_cmp(*self, *rhs)
    }
}
impl protocol::Parse for LengthValue {
    #[inline]
    fn parse(input: &mut Parser) -> CssResult<Self> {
        LengthValue::parse(input)
    }
}
impl protocol::ToCss for LengthValue {
    #[inline]
    fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        LengthValue::to_css(*self, dest)
    }
}
impl protocol::IsCompatible for LengthValue {
    #[inline]
    fn is_compatible(&self, browsers: &Browsers) -> bool {
        LengthValue::is_compatible(*self, browsers)
    }
}

// Angle protocol impls (needed for `DimensionPercentage<Angle>` = AnglePercentage).
impl protocol::Zero for Angle {
    #[inline]
    fn zero() -> Self {
        Angle::zero()
    }
    #[inline]
    fn is_zero(&self) -> bool {
        Angle::is_zero(*self)
    }
}
impl protocol::MulF32 for Angle {
    #[inline]
    fn mul_f32(self, rhs: f32) -> Self {
        Angle::mul_f32(self, rhs)
    }
}
impl protocol::TryAdd for Angle {
    #[inline]
    fn try_add(&self, rhs: &Self) -> Option<Self> {
        Angle::try_add(*self, *rhs)
    }
}
impl protocol::TryFromAngle for Angle {
    #[inline]
    fn try_from_angle(a: Angle) -> Option<Self> {
        Some(a)
    }
}
impl protocol::TrySign for Angle {
    #[inline]
    fn try_sign(&self) -> Option<f32> {
        Some(self.sign())
    }
}
impl protocol::TryMap for Angle {
    #[inline]
    fn try_map(&self, f: impl Fn(f32) -> f32) -> Option<Self> {
        Some(self.map(f))
    }
}
impl protocol::TryOp for Angle {
    #[inline]
    fn try_op<C>(&self, rhs: &Self, ctx: C, f: impl Fn(C, f32, f32) -> f32) -> Option<Self> {
        // `Angle::op` takes a `fn(C, f32, f32)` pointer, so we can't pass the
        // generic closure through it. Inline the per-variant dispatch here instead.
        Some(match (self, rhs) {
            (Angle::Deg(a), Angle::Deg(b)) => Angle::Deg(f(ctx, *a, *b)),
            (Angle::Rad(a), Angle::Rad(b)) => Angle::Rad(f(ctx, *a, *b)),
            (Angle::Grad(a), Angle::Grad(b)) => Angle::Grad(f(ctx, *a, *b)),
            (Angle::Turn(a), Angle::Turn(b)) => Angle::Turn(f(ctx, *a, *b)),
            _ => Angle::Deg(f(ctx, self.to_degrees(), rhs.to_degrees())),
        })
    }
}
impl protocol::TryOpTo for Angle {
    #[inline]
    fn try_op_to<R, C>(&self, rhs: &Self, ctx: C, f: impl Fn(C, f32, f32) -> R) -> Option<R> {
        Some(match (self, rhs) {
            (Angle::Deg(a), Angle::Deg(b)) => f(ctx, *a, *b),
            (Angle::Rad(a), Angle::Rad(b)) => f(ctx, *a, *b),
            (Angle::Grad(a), Angle::Grad(b)) => f(ctx, *a, *b),
            (Angle::Turn(a), Angle::Turn(b)) => f(ctx, *a, *b),
            _ => f(ctx, self.to_degrees(), rhs.to_degrees()),
        })
    }
}
impl protocol::PartialCmp for Angle {
    #[inline]
    fn partial_cmp(&self, rhs: &Self) -> Option<Ordering> {
        Angle::partial_cmp(*self, *rhs)
    }
}
impl protocol::Parse for Angle {
    #[inline]
    fn parse(input: &mut Parser) -> CssResult<Self> {
        Angle::parse(input)
    }
}
impl protocol::ToCss for Angle {
    #[inline]
    fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        Angle::to_css(*self, dest)
    }
}
impl protocol::IsCompatible for Angle {
    #[inline]
    fn is_compatible(&self, _: &Browsers) -> bool {
        true
    }
}
