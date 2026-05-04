use bumpalo::collections::Vec as BumpVec;
use bun_alloc::Arena as Bump;
use bun_str::strings;

use crate::css_properties::{Property, PropertyId};
use crate::css_values::angle::Angle;
use crate::css_values::length::{LengthPercentage, LengthValue as Length};
use crate::css_values::percentage::NumberOrPercentage;
use crate::prefixes;
use crate::{
    CSSNumberFns, DeclarationList, Parser, PrintErr, Printer, PrinterOptions,
    PropertyHandlerContext, Result, Token, VendorPrefix,
};

/// A value for the [transform](https://www.w3.org/TR/2019/CR-css-transforms-1-20190214/#propdef-transform) property.
#[derive(Clone, PartialEq)]
pub struct TransformList<'bump> {
    pub v: BumpVec<'bump, Transform>,
}

impl<'bump> TransformList<'bump> {
    pub fn parse(input: &mut Parser<'bump, '_>) -> Result<Self> {
        if input
            .try_parse(|i| i.expect_ident_matching("none"))
            .is_ok()
        {
            return Ok(Self { v: BumpVec::new_in(input.allocator()) });
        }

        input.skip_whitespace();
        let mut results = BumpVec::<Transform>::new_in(input.allocator());
        let first = Transform::parse(input)?;
        results.push(first);

        loop {
            input.skip_whitespace();
            if let Some(item) = input.try_parse(Transform::parse).ok() {
                results.push(item);
            } else {
                return Ok(Self { v: results });
            }
        }
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        if self.v.is_empty() {
            return dest.write_str("none");
        }

        // TODO: Re-enable with a better solution
        //       See: https://github.com/parcel-bundler/lightningcss/issues/288
        if dest.minify {
            // PERF(port): was arena-backed std.Io.Writer.Allocating — profile in Phase B
            let mut base: Vec<u8> = Vec::new();

            let scratchbuf: Vec<u8> = Vec::new();
            // TODO(port): Printer::new signature — Zig passed dest.allocator + scratchbuf + writer;
            // Rust Printer likely takes (&'bump Bump, scratch, writer, opts, import_info, local_names, symbols).
            let mut p = Printer::new(
                scratchbuf,
                &mut base,
                PrinterOptions::default_with_minify(true),
                dest.import_info,
                dest.local_names,
                dest.symbols,
            );

            self.to_css_base(&mut p)?;

            return dest.write_str(&base);
        }

        self.to_css_base(dest)
    }

    fn to_css_base(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        for item in self.v.iter() {
            item.to_css(dest)?;
        }
        Ok(())
    }

    pub fn deep_clone(&self, bump: &'bump Bump) -> Self {
        // TODO(port): css.implementDeepClone reflection — replace with crate-wide DeepClone derive
        let mut v = BumpVec::with_capacity_in(self.v.len(), bump);
        for item in self.v.iter() {
            v.push(item.deep_clone(bump));
        }
        Self { v }
    }

    pub fn eql(&self, other: &Self) -> bool {
        self == other
    }
}

/// An individual transform function (https://www.w3.org/TR/2019/CR-css-transforms-1-20190214/#two-d-transform-functions).
#[derive(Clone, PartialEq)]
pub enum Transform {
    /// A 2D translation.
    Translate {
        x: LengthPercentage,
        y: LengthPercentage,
    },
    /// A translation in the X direction.
    TranslateX(LengthPercentage),
    /// A translation in the Y direction.
    TranslateY(LengthPercentage),
    /// A translation in the Z direction.
    TranslateZ(Length),
    /// A 3D translation.
    Translate3d {
        x: LengthPercentage,
        y: LengthPercentage,
        z: Length,
    },
    /// A 2D scale.
    Scale {
        x: NumberOrPercentage,
        y: NumberOrPercentage,
    },
    /// A scale in the X direction.
    ScaleX(NumberOrPercentage),
    /// A scale in the Y direction.
    ScaleY(NumberOrPercentage),
    /// A scale in the Z direction.
    ScaleZ(NumberOrPercentage),
    /// A 3D scale.
    Scale3d {
        x: NumberOrPercentage,
        y: NumberOrPercentage,
        z: NumberOrPercentage,
    },
    /// A 2D rotation.
    Rotate(Angle),
    /// A rotation around the X axis.
    RotateX(Angle),
    /// A rotation around the Y axis.
    RotateY(Angle),
    /// A rotation around the Z axis.
    RotateZ(Angle),
    /// A 3D rotation.
    Rotate3d {
        x: f32,
        y: f32,
        z: f32,
        angle: Angle,
    },
    /// A 2D skew.
    Skew { x: Angle, y: Angle },
    /// A skew along the X axis.
    SkewX(Angle),
    /// A skew along the Y axis.
    SkewY(Angle),
    /// A perspective transform.
    Perspective(Length),
    /// A 2D matrix transform.
    Matrix(Matrix<f32>),
    /// A 3D matrix transform.
    Matrix3d(Matrix3d<f32>),
}

impl Transform {
    pub fn parse(input: &mut Parser) -> Result<Transform> {
        let function = input.expect_function()?;

        // PORT NOTE: Zig used a Closure struct + nested anon-struct fn passed to
        // parseNestedBlock; Rust closures capture `function` directly.
        input.parse_nested_block(|i| -> Result<Transform> {
            let location = i.current_source_location();
            if strings::eql_case_insensitive_ascii_check_length(function, b"matrix") {
                let a = CSSNumberFns::parse(i)?;
                i.expect_comma()?;
                let b = CSSNumberFns::parse(i)?;
                i.expect_comma()?;
                let c = CSSNumberFns::parse(i)?;
                i.expect_comma()?;
                let d = CSSNumberFns::parse(i)?;
                i.expect_comma()?;
                let e = CSSNumberFns::parse(i)?;
                i.expect_comma()?;
                let f = CSSNumberFns::parse(i)?;
                Ok(Transform::Matrix(Matrix { a, b, c, d, e, f }))
            } else if strings::eql_case_insensitive_ascii_check_length(function, b"matrix3d") {
                let m11 = CSSNumberFns::parse(i)?;
                i.expect_comma()?;
                let m12 = CSSNumberFns::parse(i)?;
                i.expect_comma()?;
                let m13 = CSSNumberFns::parse(i)?;
                i.expect_comma()?;
                let m14 = CSSNumberFns::parse(i)?;
                i.expect_comma()?;
                let m21 = CSSNumberFns::parse(i)?;
                i.expect_comma()?;
                let m22 = CSSNumberFns::parse(i)?;
                i.expect_comma()?;
                let m23 = CSSNumberFns::parse(i)?;
                i.expect_comma()?;
                let m24 = CSSNumberFns::parse(i)?;
                i.expect_comma()?;
                let m31 = CSSNumberFns::parse(i)?;
                i.expect_comma()?;
                let m32 = CSSNumberFns::parse(i)?;
                i.expect_comma()?;
                let m33 = CSSNumberFns::parse(i)?;
                i.expect_comma()?;
                let m34 = CSSNumberFns::parse(i)?;
                i.expect_comma()?;
                let m41 = CSSNumberFns::parse(i)?;
                i.expect_comma()?;
                let m42 = CSSNumberFns::parse(i)?;
                i.expect_comma()?;
                let m43 = CSSNumberFns::parse(i)?;
                i.expect_comma()?;
                let m44 = CSSNumberFns::parse(i)?;
                Ok(Transform::Matrix3d(Matrix3d {
                    m11, m12, m13, m14,
                    m21, m22, m23, m24,
                    m31, m32, m33, m34,
                    m41, m42, m43, m44,
                }))
            } else if strings::eql_case_insensitive_ascii_check_length(function, b"translate") {
                let x = LengthPercentage::parse(i)?;
                if i.try_parse(|p| p.expect_comma()).is_ok() {
                    let y = LengthPercentage::parse(i)?;
                    Ok(Transform::Translate { x, y })
                } else {
                    Ok(Transform::Translate { x, y: LengthPercentage::zero() })
                }
            } else if strings::eql_case_insensitive_ascii_check_length(function, b"translatex") {
                let x = LengthPercentage::parse(i)?;
                Ok(Transform::TranslateX(x))
            } else if strings::eql_case_insensitive_ascii_check_length(function, b"translatey") {
                let y = LengthPercentage::parse(i)?;
                Ok(Transform::TranslateY(y))
            } else if strings::eql_case_insensitive_ascii_check_length(function, b"translatez") {
                let z = Length::parse(i)?;
                Ok(Transform::TranslateZ(z))
            } else if strings::eql_case_insensitive_ascii_check_length(function, b"translate3d") {
                let x = LengthPercentage::parse(i)?;
                i.expect_comma()?;
                let y = LengthPercentage::parse(i)?;
                i.expect_comma()?;
                let z = Length::parse(i)?;
                Ok(Transform::Translate3d { x, y, z })
            } else if strings::eql_case_insensitive_ascii_check_length(function, b"scale") {
                let x = NumberOrPercentage::parse(i)?;
                if i.try_parse(|p| p.expect_comma()).is_ok() {
                    let y = NumberOrPercentage::parse(i)?;
                    Ok(Transform::Scale { x, y })
                } else {
                    let y = x.deep_clone(i.allocator());
                    Ok(Transform::Scale { x, y })
                }
            } else if strings::eql_case_insensitive_ascii_check_length(function, b"scalex") {
                let x = NumberOrPercentage::parse(i)?;
                Ok(Transform::ScaleX(x))
            } else if strings::eql_case_insensitive_ascii_check_length(function, b"scaley") {
                let y = NumberOrPercentage::parse(i)?;
                Ok(Transform::ScaleY(y))
            } else if strings::eql_case_insensitive_ascii_check_length(function, b"scalez") {
                let z = NumberOrPercentage::parse(i)?;
                Ok(Transform::ScaleZ(z))
            } else if strings::eql_case_insensitive_ascii_check_length(function, b"scale3d") {
                let x = NumberOrPercentage::parse(i)?;
                i.expect_comma()?;
                let y = NumberOrPercentage::parse(i)?;
                i.expect_comma()?;
                let z = NumberOrPercentage::parse(i)?;
                Ok(Transform::Scale3d { x, y, z })
            } else if strings::eql_case_insensitive_ascii_check_length(function, b"rotate") {
                let angle = Angle::parse_with_unitless_zero(i)?;
                Ok(Transform::Rotate(angle))
            } else if strings::eql_case_insensitive_ascii_check_length(function, b"rotatex") {
                let angle = Angle::parse_with_unitless_zero(i)?;
                Ok(Transform::RotateX(angle))
            } else if strings::eql_case_insensitive_ascii_check_length(function, b"rotatey") {
                let angle = Angle::parse_with_unitless_zero(i)?;
                Ok(Transform::RotateY(angle))
            } else if strings::eql_case_insensitive_ascii_check_length(function, b"rotatez") {
                let angle = Angle::parse_with_unitless_zero(i)?;
                Ok(Transform::RotateZ(angle))
            } else if strings::eql_case_insensitive_ascii_check_length(function, b"rotate3d") {
                let x = CSSNumberFns::parse(i)?;
                i.expect_comma()?;
                let y = CSSNumberFns::parse(i)?;
                i.expect_comma()?;
                let z = CSSNumberFns::parse(i)?;
                i.expect_comma()?;
                let angle = Angle::parse_with_unitless_zero(i)?;
                Ok(Transform::Rotate3d { x, y, z, angle })
            } else if strings::eql_case_insensitive_ascii_check_length(function, b"skew") {
                let x = Angle::parse_with_unitless_zero(i)?;
                if i.try_parse(|p| p.expect_comma()).is_ok() {
                    let y = Angle::parse_with_unitless_zero(i)?;
                    Ok(Transform::Skew { x, y })
                } else {
                    Ok(Transform::Skew { x, y: Angle::Deg(0.0) })
                }
            } else if strings::eql_case_insensitive_ascii_check_length(function, b"skewx") {
                let angle = Angle::parse_with_unitless_zero(i)?;
                Ok(Transform::SkewX(angle))
            } else if strings::eql_case_insensitive_ascii_check_length(function, b"skewy") {
                let angle = Angle::parse_with_unitless_zero(i)?;
                Ok(Transform::SkewY(angle))
            } else if strings::eql_case_insensitive_ascii_check_length(function, b"perspective") {
                let len = Length::parse(i)?;
                Ok(Transform::Perspective(len))
            } else {
                Err(location.new_unexpected_token_error(Token::Ident(function)))
            }
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        match self {
            Transform::Translate { x, y } => {
                if dest.minify && x.is_zero() && !y.is_zero() {
                    dest.write_str("translateY(")?;
                    y.to_css(dest)?;
                } else {
                    dest.write_str("translate(")?;
                    x.to_css(dest)?;
                    if !y.is_zero() {
                        dest.delim(',', false)?;
                        y.to_css(dest)?;
                    }
                }
                dest.write_char(')')?;
            }
            Transform::TranslateX(x) => {
                dest.write_str(if dest.minify { "translate(" } else { "translateX(" })?;
                x.to_css(dest)?;
                dest.write_char(')')?;
            }
            Transform::TranslateY(y) => {
                dest.write_str("translateY(")?;
                y.to_css(dest)?;
                dest.write_char(')')?;
            }
            Transform::TranslateZ(z) => {
                dest.write_str("translateZ(")?;
                z.to_css(dest)?;
                dest.write_char(')')?;
            }
            Transform::Translate3d { x, y, z } => {
                if dest.minify && !x.is_zero() && y.is_zero() && z.is_zero() {
                    dest.write_str("translate(")?;
                    x.to_css(dest)?;
                } else if dest.minify && x.is_zero() && !y.is_zero() && z.is_zero() {
                    dest.write_str("translateY(")?;
                    y.to_css(dest)?;
                } else if dest.minify && x.is_zero() && y.is_zero() && !z.is_zero() {
                    dest.write_str("translateZ(")?;
                    z.to_css(dest)?;
                } else if dest.minify && z.is_zero() {
                    dest.write_str("translate(")?;
                    x.to_css(dest)?;
                    dest.delim(',', false)?;
                    y.to_css(dest)?;
                } else {
                    dest.write_str("translate3d(")?;
                    x.to_css(dest)?;
                    dest.delim(',', false)?;
                    y.to_css(dest)?;
                    dest.delim(',', false)?;
                    z.to_css(dest)?;
                }
                dest.write_char(')')?;
            }
            Transform::Scale { x: sx, y: sy } => {
                let x: f32 = sx.into_f32();
                let y: f32 = sy.into_f32();
                if dest.minify && x == 1.0 && y != 1.0 {
                    dest.write_str("scaleY(")?;
                    CSSNumberFns::to_css(&y, dest)?;
                } else if dest.minify && x != 1.0 && y == 1.0 {
                    dest.write_str("scaleX(")?;
                    CSSNumberFns::to_css(&x, dest)?;
                } else {
                    dest.write_str("scale(")?;
                    CSSNumberFns::to_css(&x, dest)?;
                    if y != x {
                        dest.delim(',', false)?;
                        CSSNumberFns::to_css(&y, dest)?;
                    }
                }
                dest.write_char(')')?;
            }
            Transform::ScaleX(x) => {
                dest.write_str("scaleX(")?;
                CSSNumberFns::to_css(&x.into_f32(), dest)?;
                dest.write_char(')')?;
            }
            Transform::ScaleY(y) => {
                dest.write_str("scaleY(")?;
                CSSNumberFns::to_css(&y.into_f32(), dest)?;
                dest.write_char(')')?;
            }
            Transform::ScaleZ(z) => {
                dest.write_str("scaleZ(")?;
                CSSNumberFns::to_css(&z.into_f32(), dest)?;
                dest.write_char(')')?;
            }
            Transform::Scale3d { x: sx, y: sy, z: sz } => {
                let x: f32 = sx.into_f32();
                let y: f32 = sy.into_f32();
                let z: f32 = sz.into_f32();
                if dest.minify && z == 1.0 && x == y {
                    dest.write_str("scale(")?;
                    CSSNumberFns::to_css(&x, dest)?;
                } else if dest.minify && x != 1.0 && y == 1.0 && z == 1.0 {
                    dest.write_str("scaleX(")?;
                    CSSNumberFns::to_css(&x, dest)?;
                } else if dest.minify && x == 1.0 && y != 1.0 && z == 1.0 {
                    dest.write_str("scaleY(")?;
                    CSSNumberFns::to_css(&y, dest)?;
                } else if dest.minify && x == 1.0 && y == 1.0 && z != 1.0 {
                    dest.write_str("scaleZ(")?;
                    CSSNumberFns::to_css(&z, dest)?;
                } else if dest.minify && z == 1.0 {
                    dest.write_str("scale(")?;
                    CSSNumberFns::to_css(&x, dest)?;
                    dest.delim(',', false)?;
                    CSSNumberFns::to_css(&y, dest)?;
                } else {
                    dest.write_str("scale3d(")?;
                    CSSNumberFns::to_css(&x, dest)?;
                    dest.delim(',', false)?;
                    CSSNumberFns::to_css(&y, dest)?;
                    dest.delim(',', false)?;
                    CSSNumberFns::to_css(&z, dest)?;
                }
                dest.write_char(')')?;
            }
            Transform::Rotate(angle) => {
                dest.write_str("rotate(")?;
                angle.to_css_with_unitless_zero(dest)?;
                dest.write_char(')')?;
            }
            Transform::RotateX(angle) => {
                dest.write_str("rotateX(")?;
                angle.to_css_with_unitless_zero(dest)?;
                dest.write_char(')')?;
            }
            Transform::RotateY(angle) => {
                dest.write_str("rotateY(")?;
                angle.to_css_with_unitless_zero(dest)?;
                dest.write_char(')')?;
            }
            Transform::RotateZ(angle) => {
                dest.write_str(if dest.minify { "rotate(" } else { "rotateZ(" })?;
                angle.to_css_with_unitless_zero(dest)?;
                dest.write_char(')')?;
            }
            Transform::Rotate3d { x, y, z, angle } => {
                if dest.minify && *x == 1.0 && *y == 0.0 && *z == 0.0 {
                    dest.write_str("rotateX(")?;
                    angle.to_css_with_unitless_zero(dest)?;
                } else if dest.minify && *x == 0.0 && *y == 1.0 && *z == 0.0 {
                    dest.write_str("rotateY(")?;
                    angle.to_css_with_unitless_zero(dest)?;
                } else if dest.minify && *x == 0.0 && *y == 0.0 && *z == 1.0 {
                    dest.write_str("rotate(")?;
                    angle.to_css_with_unitless_zero(dest)?;
                } else {
                    dest.write_str("rotate3d(")?;
                    CSSNumberFns::to_css(x, dest)?;
                    dest.delim(',', false)?;
                    CSSNumberFns::to_css(y, dest)?;
                    dest.delim(',', false)?;
                    CSSNumberFns::to_css(z, dest)?;
                    dest.delim(',', false)?;
                    angle.to_css_with_unitless_zero(dest)?;
                }
                dest.write_char(')')?;
            }
            Transform::Skew { x, y } => {
                if dest.minify && x.is_zero() && !y.is_zero() {
                    dest.write_str("skewY(")?;
                    y.to_css_with_unitless_zero(dest)?;
                } else {
                    dest.write_str("skew(")?;
                    x.to_css(dest)?;
                    if !y.is_zero() {
                        dest.delim(',', false)?;
                        y.to_css_with_unitless_zero(dest)?;
                    }
                }
                dest.write_char(')')?;
            }
            Transform::SkewX(angle) => {
                dest.write_str(if dest.minify { "skew(" } else { "skewX(" })?;
                angle.to_css_with_unitless_zero(dest)?;
                dest.write_char(')')?;
            }
            Transform::SkewY(angle) => {
                dest.write_str("skewY(")?;
                angle.to_css_with_unitless_zero(dest)?;
                dest.write_char(')')?;
            }
            Transform::Perspective(len) => {
                dest.write_str("perspective(")?;
                len.to_css(dest)?;
                dest.write_char(')')?;
            }
            Transform::Matrix(m) => {
                dest.write_str("matrix(")?;
                CSSNumberFns::to_css(&m.a, dest)?;
                dest.delim(',', false)?;
                CSSNumberFns::to_css(&m.b, dest)?;
                dest.delim(',', false)?;
                CSSNumberFns::to_css(&m.c, dest)?;
                dest.delim(',', false)?;
                CSSNumberFns::to_css(&m.d, dest)?;
                dest.delim(',', false)?;
                CSSNumberFns::to_css(&m.e, dest)?;
                dest.delim(',', false)?;
                CSSNumberFns::to_css(&m.f, dest)?;
                dest.write_char(')')?;
            }
            Transform::Matrix3d(m) => {
                dest.write_str("matrix3d(")?;
                CSSNumberFns::to_css(&m.m11, dest)?;
                dest.delim(',', false)?;
                CSSNumberFns::to_css(&m.m12, dest)?;
                dest.delim(',', false)?;
                CSSNumberFns::to_css(&m.m13, dest)?;
                dest.delim(',', false)?;
                CSSNumberFns::to_css(&m.m14, dest)?;
                dest.delim(',', false)?;
                CSSNumberFns::to_css(&m.m21, dest)?;
                dest.delim(',', false)?;
                CSSNumberFns::to_css(&m.m22, dest)?;
                dest.delim(',', false)?;
                CSSNumberFns::to_css(&m.m23, dest)?;
                dest.delim(',', false)?;
                CSSNumberFns::to_css(&m.m24, dest)?;
                dest.delim(',', false)?;
                CSSNumberFns::to_css(&m.m31, dest)?;
                dest.delim(',', false)?;
                CSSNumberFns::to_css(&m.m32, dest)?;
                dest.delim(',', false)?;
                CSSNumberFns::to_css(&m.m33, dest)?;
                dest.delim(',', false)?;
                CSSNumberFns::to_css(&m.m34, dest)?;
                dest.delim(',', false)?;
                CSSNumberFns::to_css(&m.m41, dest)?;
                dest.delim(',', false)?;
                CSSNumberFns::to_css(&m.m42, dest)?;
                dest.delim(',', false)?;
                CSSNumberFns::to_css(&m.m43, dest)?;
                dest.delim(',', false)?;
                CSSNumberFns::to_css(&m.m44, dest)?;
                dest.write_char(')')?;
            }
        }
        Ok(())
    }

    pub fn deep_clone(&self, _bump: &Bump) -> Self {
        // TODO(port): css.implementDeepClone reflection — payload types may need bump-aware clone
        self.clone()
    }

    pub fn eql(&self, other: &Self) -> bool {
        self == other
    }
}

/// A 2D matrix.
#[derive(Clone, Copy, PartialEq)]
pub struct Matrix<T> {
    pub a: T,
    pub b: T,
    pub c: T,
    pub d: T,
    pub e: T,
    pub f: T,
}

impl<T: Clone> Matrix<T> {
    pub fn deep_clone(&self, _bump: &Bump) -> Self {
        self.clone()
    }

    pub fn eql(&self, rhs: &Self) -> bool
    where
        T: PartialEq,
    {
        self == rhs
    }
}

/// A 3D matrix.
#[derive(Clone, Copy, PartialEq)]
pub struct Matrix3d<T> {
    pub m11: T,
    pub m12: T,
    pub m13: T,
    pub m14: T,
    pub m21: T,
    pub m22: T,
    pub m23: T,
    pub m24: T,
    pub m31: T,
    pub m32: T,
    pub m33: T,
    pub m34: T,
    pub m41: T,
    pub m42: T,
    pub m43: T,
    pub m44: T,
}

impl<T: PartialEq> Matrix3d<T> {
    pub fn eql(&self, rhs: &Self) -> bool {
        self == rhs
    }
}

/// A value for the [transform-style](https://drafts.csswg.org/css-transforms-2/#transform-style-property) property.
// TODO(port): css.DefineEnumProperty reflection → crate-wide #[derive(EnumProperty)] providing
// parse/to_css/eql/hash/deep_clone from kebab-case variant names.
#[derive(Clone, Copy, PartialEq, Eq, Hash, crate::DefineEnumProperty)]
pub enum TransformStyle {
    #[css("flat")]
    Flat,
    #[css("preserve-3d")]
    Preserve3d,
}

/// A value for the [transform-box](https://drafts.csswg.org/css-transforms-1/#transform-box) property.
#[derive(Clone, Copy, PartialEq, Eq, Hash, crate::DefineEnumProperty)]
pub enum TransformBox {
    /// Uses the content box as reference box.
    #[css("content-box")]
    ContentBox,
    /// Uses the border box as reference box.
    #[css("border-box")]
    BorderBox,
    /// Uses the object bounding box as reference box.
    #[css("fill-box")]
    FillBox,
    /// Uses the stroke bounding box as reference box.
    #[css("stroke-box")]
    StrokeBox,
    /// Uses the nearest SVG viewport as reference box.
    #[css("view-box")]
    ViewBox,
}

/// A value for the [backface-visibility](https://drafts.csswg.org/css-transforms-2/#backface-visibility-property) property.
#[derive(Clone, Copy, PartialEq, Eq, Hash, crate::DefineEnumProperty)]
pub enum BackfaceVisibility {
    #[css("visible")]
    Visible,
    #[css("hidden")]
    Hidden,
}

/// A value for the perspective property.
// TODO(port): css.DeriveParse / css.DeriveToCss reflection → crate-wide derives.
#[derive(Clone, PartialEq, crate::DeriveParse, crate::DeriveToCss)]
pub enum Perspective {
    /// No perspective transform is applied.
    None,
    /// Distance to the center of projection.
    Length(Length),
}

impl Perspective {
    pub fn eql(&self, other: &Self) -> bool {
        self == other
    }

    pub fn deep_clone(&self, _bump: &Bump) -> Self {
        self.clone()
    }
}

/// A value for the [translate](https://drafts.csswg.org/css-transforms-2/#propdef-translate) property.
#[derive(Clone, PartialEq)]
pub enum Translate {
    /// The "none" keyword.
    None,

    /// The x, y, and z translations.
    Xyz {
        /// The x translation.
        x: LengthPercentage,
        /// The y translation.
        y: LengthPercentage,
        /// The z translation.
        z: Length,
    },
}

impl Translate {
    pub fn parse(input: &mut Parser) -> Result<Self> {
        if input
            .try_parse(|i| i.expect_ident_matching("none"))
            .is_ok()
        {
            return Ok(Translate::None);
        }

        let x = LengthPercentage::parse(input)?;
        let y = input.try_parse(LengthPercentage::parse);
        let z = if y.is_ok() {
            input.try_parse(Length::parse).ok()
        } else {
            None
        };

        Ok(Translate::Xyz {
            x,
            y: y.unwrap_or(LengthPercentage::zero()),
            z: z.unwrap_or(Length::zero()),
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        match self {
            Translate::None => dest.write_str("none")?,
            Translate::Xyz { x, y, z } => {
                x.to_css(dest)?;
                if !y.is_zero() || !z.is_zero() {
                    dest.write_char(' ')?;
                    y.to_css(dest)?;
                    if !z.is_zero() {
                        dest.write_char(' ')?;
                        z.to_css(dest)?;
                    }
                }
            }
        }
        Ok(())
    }

    pub fn to_transform(&self, bump: &Bump) -> Transform {
        match self {
            Translate::None => Transform::Translate3d {
                x: LengthPercentage::zero(),
                y: LengthPercentage::zero(),
                z: Length::zero(),
            },
            Translate::Xyz { x, y, z } => Transform::Translate3d {
                x: x.deep_clone(bump),
                y: y.deep_clone(bump),
                z: z.deep_clone(bump),
            },
        }
    }

    pub fn eql(&self, other: &Self) -> bool {
        self == other
    }

    pub fn deep_clone(&self, _bump: &Bump) -> Self {
        // TODO(port): css.implementDeepClone — arena-aware clone for LengthPercentage
        self.clone()
    }
}

/// A value for the [rotate](https://drafts.csswg.org/css-transforms-2/#propdef-rotate) property.
#[derive(Clone, PartialEq)]
pub struct Rotate {
    /// Rotation around the x axis.
    pub x: f32,
    /// Rotation around the y axis.
    pub y: f32,
    /// Rotation around the z axis.
    pub z: f32,
    /// The angle of rotation.
    pub angle: Angle,
}

impl Rotate {
    pub fn parse(input: &mut Parser) -> Result<Self> {
        if input
            .try_parse(|i| i.expect_ident_matching("none"))
            .is_ok()
        {
            return Ok(Rotate {
                x: 0.0,
                y: 0.0,
                z: 1.0,
                angle: Angle::Deg(0.0),
            });
        }

        let angle = input.try_parse(Angle::parse);

        struct Xyz {
            x: f32,
            y: f32,
            z: f32,
        }

        let xyz = match input.try_parse(|i| -> Result<Xyz> {
            let location = i.current_source_location();
            let ident = i.expect_ident()?;
            if strings::eql_case_insensitive_ascii_check_length(ident, b"x") {
                return Ok(Xyz { x: 1.0, y: 0.0, z: 0.0 });
            } else if strings::eql_case_insensitive_ascii_check_length(ident, b"y") {
                return Ok(Xyz { x: 0.0, y: 1.0, z: 0.0 });
            } else if strings::eql_case_insensitive_ascii_check_length(ident, b"z") {
                return Ok(Xyz { x: 0.0, y: 0.0, z: 1.0 });
            }
            Err(location.new_unexpected_token_error(Token::Ident(ident)))
        }) {
            Ok(v) => v,
            Err(_) => input
                .try_parse(|i| -> Result<Xyz> {
                    let x = CSSNumberFns::parse(i)?;
                    let y = CSSNumberFns::parse(i)?;
                    let z = CSSNumberFns::parse(i)?;
                    Ok(Xyz { x, y, z })
                })
                .unwrap_or(Xyz { x: 0.0, y: 0.0, z: 1.0 }),
        };

        let final_angle = match angle {
            Ok(v) => v,
            Err(_) => Angle::parse(input)?,
        };

        Ok(Rotate {
            x: xyz.x,
            y: xyz.y,
            z: xyz.z,
            angle: final_angle,
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        if self.x == 0.0 && self.y == 0.0 && self.z == 1.0 && self.angle.is_zero() {
            dest.write_str("none")?;
            return Ok(());
        }

        if self.x == 1.0 && self.y == 0.0 && self.z == 0.0 {
            dest.write_str("x ")?;
        } else if self.x == 0.0 && self.y == 1.0 && self.z == 0.0 {
            dest.write_str("y ")?;
        } else if !(self.x == 0.0 && self.y == 0.0 && self.z == 1.0) {
            CSSNumberFns::to_css(&self.x, dest)?;
            dest.write_char(' ')?;
            CSSNumberFns::to_css(&self.y, dest)?;
            dest.write_char(' ')?;
            CSSNumberFns::to_css(&self.z, dest)?;
            dest.write_char(' ')?;
        }

        self.angle.to_css(dest)
    }

    /// Converts the rotation to a transform function.
    pub fn to_transform(&self, bump: &Bump) -> Transform {
        Transform::Rotate3d {
            x: self.x,
            y: self.y,
            z: self.z,
            angle: self.angle.deep_clone(bump),
        }
    }

    pub fn eql(&self, other: &Self) -> bool {
        self == other
    }

    pub fn deep_clone(&self, _bump: &Bump) -> Self {
        self.clone()
    }
}

/// A value for the [scale](https://drafts.csswg.org/css-transforms-2/#propdef-scale) property.
#[derive(Clone, PartialEq)]
pub enum Scale {
    /// The "none" keyword.
    None,

    /// Scale on the x, y, and z axis.
    Xyz {
        /// Scale on the x axis.
        x: NumberOrPercentage,
        /// Scale on the y axis.
        y: NumberOrPercentage,
        /// Scale on the z axis.
        z: NumberOrPercentage,
    },
}

impl Scale {
    pub fn parse(input: &mut Parser) -> Result<Self> {
        if input
            .try_parse(|i| i.expect_ident_matching("none"))
            .is_ok()
        {
            return Ok(Scale::None);
        }

        let x = NumberOrPercentage::parse(input)?;

        let y = input.try_parse(NumberOrPercentage::parse);
        let z = if y.is_ok() {
            input.try_parse(NumberOrPercentage::parse).ok()
        } else {
            None
        };

        Ok(Scale::Xyz {
            x: x.clone(),
            y: if let Ok(val) = y { val } else { x },
            z: if let Some(val) = z { val } else { NumberOrPercentage::Number(1.0) },
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        match self {
            Scale::None => dest.write_str("none")?,
            Scale::Xyz { x, y, z } => {
                x.to_css(dest)?;
                let z_val = z.into_f32();
                if y != x || z_val != 1.0 {
                    dest.write_char(' ')?;
                    y.to_css(dest)?;
                    if z_val != 1.0 {
                        dest.write_char(' ')?;
                        z.to_css(dest)?;
                    }
                }
            }
        }
        Ok(())
    }

    pub fn to_transform(&self, bump: &Bump) -> Transform {
        match self {
            Scale::None => Transform::Scale3d {
                x: NumberOrPercentage::Number(1.0),
                y: NumberOrPercentage::Number(1.0),
                z: NumberOrPercentage::Number(1.0),
            },
            Scale::Xyz { x, y, z } => Transform::Scale3d {
                x: x.deep_clone(bump),
                y: y.deep_clone(bump),
                z: z.deep_clone(bump),
            },
        }
    }

    pub fn eql(&self, other: &Self) -> bool {
        self == other
    }

    pub fn deep_clone(&self, _bump: &Bump) -> Self {
        self.clone()
    }
}

#[derive(Default)]
pub struct TransformHandler<'bump> {
    pub transform: Option<(TransformList<'bump>, VendorPrefix)>,
    pub translate: Option<Translate>,
    pub rotate: Option<Rotate>,
    pub scale: Option<Scale>,
    pub has_any: bool,
}

impl<'bump> TransformHandler<'bump> {
    pub fn handle_property(
        &mut self,
        property: &Property,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) -> bool {
        // PORT NOTE: Zig used a local fn with `comptime field: []const u8` + `@field(self, field)`.
        // Rust cannot index struct fields by string at runtime; use a macro to paste the ident.
        macro_rules! individual_property {
            ($field:ident, $val:expr) => {{
                let bump = context.allocator;
                if let Some(transform) = &mut self.transform {
                    transform.0.v.push($val.to_transform(bump));
                } else {
                    self.$field = Some($val.deep_clone(bump));
                    self.has_any = true;
                }
            }};
        }

        let bump = context.allocator;

        match property {
            Property::Transform(val) => {
                let transform_val = &val.0;
                let vp = val.1;

                // If two vendor prefixes for the same property have different
                // values, we need to flush what we have immediately to preserve order.
                if let Some(current) = &self.transform {
                    if current.0 != *transform_val && !current.1.contains(vp) {
                        self.flush(bump, dest, context);
                    }
                }

                // Otherwise, update the value and add the prefix.
                if let Some(transform) = &mut self.transform {
                    *transform = (transform_val.deep_clone(bump), transform.1 | vp);
                } else {
                    self.transform = Some((transform_val.deep_clone(bump), vp));
                    self.has_any = true;
                }

                self.translate = None;
                self.rotate = None;
                self.scale = None;
            }
            Property::Translate(val) => individual_property!(translate, val),
            Property::Rotate(val) => individual_property!(rotate, val),
            Property::Scale(val) => individual_property!(scale, val),
            Property::Unparsed(unparsed) => {
                if unparsed.property_id == PropertyId::Transform
                    || unparsed.property_id == PropertyId::Translate
                    || unparsed.property_id == PropertyId::Rotate
                    || unparsed.property_id == PropertyId::Scale
                {
                    self.flush(bump, dest, context);
                    let prop = if unparsed.property_id == PropertyId::Transform {
                        Property::Unparsed(unparsed.get_prefixed(
                            bump,
                            context.targets,
                            prefixes::Feature::Transform,
                        ))
                    } else {
                        property.deep_clone(bump)
                    };
                    dest.push(prop);
                } else {
                    return false;
                }
            }
            _ => return false,
        }

        true
    }

    pub fn finalize(&mut self, dest: &mut DeclarationList, context: &mut PropertyHandlerContext) {
        self.flush(context.allocator, dest, context);
    }

    fn flush(
        &mut self,
        bump: &'bump Bump,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) {
        let _ = bump;
        if !self.has_any {
            return;
        }

        self.has_any = false;

        let transform = self.transform.take();
        let translate = self.translate.take();
        let rotate = self.rotate.take();
        let scale = self.scale.take();

        if let Some(t) = transform {
            let prefix = context.targets.prefixes(t.1, prefixes::Feature::Transform);
            dest.push(Property::Transform((t.0, prefix)));
        }

        if let Some(t) = translate {
            dest.push(Property::Translate(t));
        }

        if let Some(r) = rotate {
            dest.push(Property::Rotate(r));
        }

        if let Some(s) = scale {
            dest.push(Property::Scale(s));
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/properties/transform.zig (1299 lines)
//   confidence: medium
//   todos:      6
//   notes:      css.Result/Printer/Parser API shapes assumed; DefineEnumProperty/DeriveParse/DeriveToCss need crate-wide derives; deep_clone uses Clone (arena-aware DeepClone trait TBD); 'bump threading on TransformList/TransformHandler may need adjustment in Phase B.
// ──────────────────────────────────────────────────────────────────────────
