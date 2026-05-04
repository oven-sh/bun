use crate as css;
use crate::css_values::angle::Angle;
use crate::css_values::calc::{Calc, MathFunction};
use crate::css_values::number::CSSNumber;
use crate::css_values::percentage::DimensionPercentage;
use crate::targets::Browsers;
use crate::{Feature, Maybe, Parser, PrintErr, Printer, Result as CssResult, Token};

use bun_str::strings;
use core::cmp::Ordering;

/// Either a [`<length>`](https://www.w3.org/TR/css-values-4/#lengths) or a [`<number>`](https://www.w3.org/TR/css-values-4/#numbers).
// TODO(port): css.DeriveParse / css.DeriveToCss → #[derive(Parse, ToCss)] proc-macro
#[derive(Clone, PartialEq)]
pub enum LengthOrNumber {
    /// A number.
    Number(CSSNumber),
    /// A length.
    Length(Length),
}

impl LengthOrNumber {
    // pub const parse = css.DeriveParse(@This()).parse;
    // pub const toCss = css.DeriveToCss(@This()).toCss;
    // TODO(port): derive Parse + ToCss traits

    pub fn is_compatible(&self, browsers: Browsers) -> bool {
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

// Zig `deinit` only freed the owned `calc` Box inside Length — handled by Drop now.
// Zig `eql` → derive(PartialEq); Zig `deepClone` → derive(Clone).

pub type LengthPercentage = DimensionPercentage<LengthValue>;

/// Either a [`<length-percentage>`](https://www.w3.org/TR/css-values-4/#typedef-length-percentage), or the `auto` keyword.
// TODO(port): css.DeriveParse / css.DeriveToCss → #[derive(Parse, ToCss)] proc-macro
#[derive(Clone, PartialEq)]
pub enum LengthPercentageOrAuto {
    /// The `auto` keyword.
    Auto,
    /// A [`<length-percentage>`](https://www.w3.org/TR/css-values-4/#typedef-length-percentage).
    Length(LengthPercentage),
}

impl LengthPercentageOrAuto {
    // pub const parse = css.DeriveParse(@This()).parse;
    // pub const toCss = css.DeriveToCss(@This()).toCss;
    // TODO(port): derive Parse + ToCss traits

    pub fn is_compatible(&self, browsers: Browsers) -> bool {
        match self {
            Self::Length(l) => l.is_compatible(browsers),
            _ => true,
        }
    }
}

// Zig `eql` → derive(PartialEq); Zig `deepClone` → derive(Clone).

const PX_PER_IN: f32 = 96.0;
const PX_PER_CM: f32 = PX_PER_IN / 2.54;
const PX_PER_MM: f32 = PX_PER_CM / 10.0;
const PX_PER_Q: f32 = PX_PER_CM / 40.0;
const PX_PER_PT: f32 = PX_PER_IN / 72.0;
const PX_PER_PC: f32 = PX_PER_IN / 6.0;

// ──────────────────────────────────────────────────────────────────────────
// LengthValue
//
// The Zig original is a `union(enum)` with ~50 variants, each carrying a single
// `CSSNumber` (f32). Nearly every method iterates `std.meta.fields(@This())` /
// `bun.meta.EnumFields(@This())` to dispatch by tag — Zig comptime reflection.
//
// Per PORTING.md §"Comptime reflection": >8 variants → small macro generator.
// `define_length_units!` generates the enum plus the handful of per-variant
// dispatch helpers (`value()`, `unit()`, `from_unit_ci()`, `map_value()`,
// `try_same_unit_op()`, `feature()`); all higher-level methods are then written
// in terms of those, keeping the logic 1:1 with the Zig.
// ──────────────────────────────────────────────────────────────────────────

macro_rules! define_length_units {
    (
        $(
            $(#[$doc:meta])*
            $variant:ident : $unit:literal => $feature:expr
        ),* $(,)?
    ) => {
        #[derive(Clone, Copy, Debug)]
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
                $(
                    if strings::eql_case_insensitive_ascii_check_length($unit, unit) {
                        return Some(Self::$variant(value));
                    }
                )*
                None
            }

            /// Apply `f` to the inner value, preserving the variant.
            #[inline]
            fn map_value(&self, f: impl FnOnce(f32) -> f32) -> Self {
                match self { $( Self::$variant(v) => Self::$variant(f(*v)), )* }
            }

            /// If `self` and `other` are the same unit, apply `f(a, b)` and return
            /// the result in that unit; else `None`.
            #[inline]
            fn try_same_unit_op(&self, other: &Self, f: impl FnOnce(f32, f32) -> f32) -> Option<Self> {
                match (self, other) {
                    $( (Self::$variant(a), Self::$variant(b)) => Some(Self::$variant(f(*a, *b))), )*
                    _ => None,
                }
            }

            /// Compat-feature gate for this unit (the Zig `FeatureMap`).
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

// The Zig `comptime { ... }` block at :253-262 statically asserts that
// `FeatureMap` covers every variant. The macro above guarantees this by
// construction (one `=> $feature` per variant), so no separate assert needed.

impl LengthValue {
    pub fn parse(input: &mut Parser) -> CssResult<Self> {
        let location = input.current_source_location();
        let token = match input.next() {
            CssResult::Ok(vv) => vv,
            CssResult::Err(e) => return CssResult::Err(e),
        };
        match token {
            Token::Dimension(dim) => {
                // todo_stuff.match_ignore_ascii_case
                if let Some(v) = Self::from_unit_ci(dim.unit, dim.num.value) {
                    return CssResult::Ok(v);
                }
            }
            Token::Number(num) => return CssResult::Ok(Self::Px(num.value)),
            _ => {}
        }
        CssResult::Err(location.new_unexpected_token_error(token.clone()))
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        let (value, unit) = self.to_unit_value();

        // The unit can be omitted if the value is zero, except inside calc()
        // expressions, where unitless numbers won't be parsed as dimensions.
        if !dest.in_calc && value == 0.0 {
            return dest.write_char(b'0');
        }

        css::serializer::serialize_dimension(value, unit, dest)
    }

    pub fn is_zero(&self) -> bool {
        self.value() == 0.0
    }

    pub fn deep_clone(&self) -> Self {
        *self
    }

    pub fn zero() -> LengthValue {
        Self::Px(0.0)
    }

    /// Attempts to convert the value to pixels.
    /// Returns `None` if the conversion is not possible.
    pub fn to_px(&self) -> Option<CSSNumber> {
        match *self {
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

    pub fn is_sign_negative(&self) -> bool {
        let Some(s) = self.try_sign() else { return false };
        css::signfns::is_sign_negative(s)
    }

    pub fn is_sign_positive(&self) -> bool {
        let Some(s) = self.try_sign() else { return false };
        css::signfns::is_sign_positive(s)
    }

    pub fn try_sign(&self) -> Option<f32> {
        Some(self.sign())
    }

    pub fn sign(&self) -> f32 {
        css::signfns::sign_f32(self.value())
    }

    pub fn try_from_token(token: &Token) -> Maybe<Self, ()> {
        match token {
            Token::Dimension(dim) => {
                if let Some(v) = Self::from_unit_ci(dim.unit, dim.num.value) {
                    return Maybe::Ok(v);
                }
            }
            _ => {}
        }
        Maybe::Err(())
    }

    pub fn to_unit_value(&self) -> (CSSNumber, &'static [u8]) {
        (self.value(), self.unit())
    }

    pub fn map(&self, map_fn: impl FnOnce(f32) -> f32) -> LengthValue {
        // PERF(port): was comptime monomorphization (`comptime map_fn: *const fn`) — profile in Phase B
        self.map_value(map_fn)
    }

    pub fn mul_f32(self, other: f32) -> LengthValue {
        self.map_value(|v| v * other)
    }

    pub fn try_from_angle(_: Angle) -> Option<Self> {
        None
    }

    pub fn partial_cmp(&self, other: &LengthValue) -> Option<Ordering> {
        if core::mem::discriminant(self) == core::mem::discriminant(other) {
            let a = self.value();
            let b = other.value();
            return css::generic::partial_cmp_f32(&a, &b);
        }

        let a = self.to_px();
        let b = other.to_px();
        if let (Some(a), Some(b)) = (a, b) {
            return css::generic::partial_cmp_f32(&a, &b);
        }
        None
    }

    pub fn try_op(
        &self,
        other: &LengthValue,
        op_fn: impl FnOnce(f32, f32) -> f32,
    ) -> Option<LengthValue> {
        // PERF(port): Zig used `ctx: anytype` + `comptime op_fn` (manual closure) — Rust closure captures ctx
        if let Some(v) = self.try_same_unit_op(other, &op_fn) {
            return Some(v);
        }

        // PORT NOTE: Zig calls `this.toPx()` for BOTH operands here (line :447) —
        // preserving that behavior verbatim; likely an upstream bug.
        let a = self.to_px();
        let b = self.to_px();
        if let (Some(a), Some(b)) = (a, b) {
            return Some(Self::Px(op_fn(a, b)));
        }
        None
    }

    pub fn try_op_to<R>(
        &self,
        other: &LengthValue,
        op_fn: impl FnOnce(f32, f32) -> R,
    ) -> Option<R> {
        if core::mem::discriminant(self) == core::mem::discriminant(other) {
            let a = self.value();
            let b = other.value();
            return Some(op_fn(a, b));
        }

        // PORT NOTE: Zig calls `this.toPx()` for BOTH operands here (line :473) —
        // preserving that behavior verbatim; likely an upstream bug.
        let a = self.to_px();
        let b = self.to_px();
        if let (Some(a), Some(b)) = (a, b) {
            return Some(op_fn(a, b));
        }
        None
    }

    pub fn hash(&self, hasher: &mut bun_wyhash::Wyhash) {
        // TODO(port): css.implementHash — f32 is not std::hash::Hash; needs bit-pattern hash helper
        css::implement_hash(self, hasher)
    }

    pub fn try_add(&self, rhs: &LengthValue) -> Option<LengthValue> {
        if let Some(v) = self.try_same_unit_op(rhs, |a, b| a + b) {
            return Some(v);
        }
        if let Some(a) = self.to_px() {
            if let Some(b) = rhs.to_px() {
                return Some(Self::Px(a + b));
            }
        }
        None
    }

    pub fn is_compatible(&self, browsers: Browsers) -> bool {
        match self.feature() {
            Some(feature) => feature.is_compatible(browsers),
            None => true,
        }
    }
}

impl PartialEq for LengthValue {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        // Zig `eql`: same tag AND equal payload (f32 `==`).
        core::mem::discriminant(self) == core::mem::discriminant(other)
            && self.value() == other.value()
    }
}

/// A CSS [`<length>`](https://www.w3.org/TR/css-values-4/#lengths) value, with support for `calc()`.
#[derive(Clone, PartialEq)]
pub enum Length {
    /// An explicitly specified length value.
    Value(LengthValue),
    /// A computed length value using `calc()`.
    Calc(Box<Calc<Length>>),
}

impl Length {
    pub fn zero() -> Length {
        Self::Value(LengthValue::zero())
    }

    pub fn deep_clone(&self) -> Length {
        // derive(Clone) on Box<Calc<Length>> already deep-clones.
        self.clone()
    }

    // Zig `deinit` → Drop on Box<Calc<Length>> handles this.

    pub fn parse(input: &mut Parser) -> CssResult<Length> {
        if let Some(calc_value) = input.try_parse(Calc::<Length>::parse).as_value() {
            // PERF: I don't like this redundant allocation
            if let Calc::Value(v) = calc_value {
                return CssResult::Ok(*v);
            }
            return CssResult::Ok(Self::Calc(Box::new(calc_value)));
        }

        let len = match LengthValue::parse(input) {
            CssResult::Ok(vv) => vv,
            CssResult::Err(e) => return CssResult::Err(e),
        };
        CssResult::Ok(Self::Value(len))
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            Self::Value(a) => a.to_css(dest),
            Self::Calc(c) => c.to_css(dest),
        }
    }

    // Zig `eql` → derive(PartialEq).

    pub fn px(p: CSSNumber) -> Length {
        Self::Value(LengthValue::Px(p))
    }

    pub fn to_px(&self) -> Option<CSSNumber> {
        match self {
            Self::Value(a) => a.to_px(),
            _ => None,
        }
    }

    pub fn mul_f32(self, other: f32) -> Length {
        match self {
            Self::Value(v) => Self::Value(v.mul_f32(other)),
            Self::Calc(c) => Self::Calc(Box::new(c.mul_f32(other))),
        }
    }

    pub fn add(self, other: Length) -> Length {
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

    pub fn add_internal(self, other: Length) -> Length {
        if let Some(r) = self.try_add(&other) {
            return r;
        }
        self.add__(other)
    }

    pub fn into_calc(self) -> Calc<Length> {
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
        // PORT NOTE: reshaped for borrowck — Zig matched on tags then accessed
        // `a.calc.value` / `b.calc.value` while both were still bound; Rust needs
        // to move out of the Box, so the conditions are folded into match guards.
    }

    fn try_add(&self, other: &Length) -> Option<Length> {
        if let (Self::Value(a), Self::Value(b)) = (self, other) {
            if let Some(res) = a.try_add(b) {
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
            // TODO(port): the Zig builds `Length{ .calc = s.left }` without
            // cloning (alias of the same heap node). With `Box` ownership we
            // must clone here; revisit if Calc nodes become arena-backed refs.
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
        // PORT NOTE: reshaped for borrowck — Zig rebinds `c` while reading `c.*`;
        // Rust moves out of the Box once and rebuilds.
    }

    pub fn try_sign(&self) -> Option<f32> {
        match self {
            Self::Value(v) => Some(v.sign()),
            Self::Calc(v) => v.try_sign(),
        }
    }

    pub fn is_sign_negative(&self) -> bool {
        let Some(s) = self.try_sign() else { return false };
        css::signfns::is_sign_negative(s)
    }

    pub fn is_sign_positive(&self) -> bool {
        let Some(s) = self.try_sign() else { return false };
        css::signfns::is_sign_positive(s)
    }

    pub fn partial_cmp(&self, other: &Length) -> Option<Ordering> {
        if let (Self::Value(a), Self::Value(b)) = (self, other) {
            return css::generic::partial_cmp(a, b);
        }
        None
    }

    pub fn try_from_angle(_: Angle) -> Option<Self> {
        None
    }

    pub fn try_map(&self, map_fn: impl FnOnce(f32) -> f32) -> Option<Length> {
        match self {
            Self::Value(v) => Some(Self::Value(v.map(map_fn))),
            _ => None,
        }
    }

    pub fn try_op(
        &self,
        other: &Length,
        op_fn: impl FnOnce(f32, f32) -> f32,
    ) -> Option<Length> {
        if let (Self::Value(a), Self::Value(b)) = (self, other) {
            if let Some(val) = a.try_op(b, op_fn) {
                return Some(Self::Value(val));
            }
            return None;
        }
        None
    }

    pub fn try_op_to<R>(
        &self,
        other: &Length,
        op_fn: impl FnOnce(f32, f32) -> R,
    ) -> Option<R> {
        if let (Self::Value(a), Self::Value(b)) = (self, other) {
            return a.try_op_to(b, op_fn);
        }
        None
    }

    pub fn is_zero(&self) -> bool {
        match self {
            Self::Value(v) => v.is_zero(),
            _ => false,
        }
    }

    pub fn is_compatible(&self, browsers: Browsers) -> bool {
        match self {
            Self::Value(v) => v.is_compatible(browsers),
            Self::Calc(c) => c.is_compatible(browsers),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/values/length.zig (797 lines)
//   confidence: medium
//   todos:      4
//   notes:      Heavy comptime-reflection collapsed into define_length_units! macro; Calc Sum-branch try_add now clones Box children (Zig aliased) — revisit if arena-backed; DeriveParse/DeriveToCss left as TODO derives.
// ──────────────────────────────────────────────────────────────────────────
