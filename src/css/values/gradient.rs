use bun_css as css;
use bun_css::css_values::angle::{Angle, AnglePercentage};
use bun_css::css_values::color::CssColor;
use bun_css::css_values::length::{Length, LengthPercentage};
use bun_css::css_values::number::{CSSNumber, CSSNumberFns};
use bun_css::css_values::percentage::NumberOrPercentage;
use bun_css::css_values::position::{
    HorizontalPositionKeyword, Position, PositionComponent, VerticalPositionKeyword,
};
use bun_css::{PrintErr, Printer, Result, VendorPrefix};
use bun_str::strings;
use bumpalo::collections::Vec as BumpVec;
use bun_alloc::Arena;

/// A CSS [`<gradient>`](https://www.w3.org/TR/css-images-3/#gradients) value.
#[derive(PartialEq)]
pub enum Gradient<'bump> {
    /// A `linear-gradient()`, and its vendor prefix.
    Linear(LinearGradient<'bump>),
    /// A `repeating-linear-gradient()`, and its vendor prefix.
    RepeatingLinear(LinearGradient<'bump>),
    /// A `radial-gradient()`, and its vendor prefix.
    Radial(RadialGradient<'bump>),
    /// A `repeating-radial-gradient`, and its vendor prefix.
    RepeatingRadial(RadialGradient<'bump>),
    /// A `conic-gradient()`.
    Conic(ConicGradient<'bump>),
    /// A `repeating-conic-gradient()`.
    RepeatingConic(ConicGradient<'bump>),
    /// A legacy `-webkit-gradient()`.
    WebkitGradient(WebKitGradient<'bump>),
}

impl<'bump> Gradient<'bump> {
    pub fn parse(input: &mut css::Parser<'bump, '_>) -> Result<Gradient<'bump>> {
        let location = input.current_source_location();
        let func = match input.expect_function() {
            Ok(vv) => vv,
            Err(e) => return Err(e),
        };
        input.parse_nested_block(|input_: &mut css::Parser<'bump, '_>| -> Result<Gradient<'bump>> {
            // TODO(port): bun.ComptimeEnumMap(...).getAnyCase — case-insensitive perfect hash.
            // Using a chain of case-insensitive comparisons for now; Phase B can swap to phf.
            if strings::eql_case_insensitive_ascii_check_length(func, b"linear-gradient") {
                Ok(Gradient::Linear(LinearGradient::parse(input_, VendorPrefix::NONE)?))
            } else if strings::eql_case_insensitive_ascii_check_length(func, b"repeating-linear-gradient") {
                Ok(Gradient::RepeatingLinear(LinearGradient::parse(input_, VendorPrefix::NONE)?))
            } else if strings::eql_case_insensitive_ascii_check_length(func, b"radial-gradient") {
                Ok(Gradient::Radial(RadialGradient::parse(input_, VendorPrefix::NONE)?))
            } else if strings::eql_case_insensitive_ascii_check_length(func, b"repeating-radial-gradient") {
                Ok(Gradient::RepeatingRadial(RadialGradient::parse(input_, VendorPrefix::NONE)?))
            } else if strings::eql_case_insensitive_ascii_check_length(func, b"conic-gradient") {
                Ok(Gradient::Conic(ConicGradient::parse(input_)?))
            } else if strings::eql_case_insensitive_ascii_check_length(func, b"repeating-conic-gradient") {
                Ok(Gradient::RepeatingConic(ConicGradient::parse(input_)?))
            } else if strings::eql_case_insensitive_ascii_check_length(func, b"-webkit-linear-gradient") {
                Ok(Gradient::Linear(LinearGradient::parse(input_, VendorPrefix::WEBKIT)?))
            } else if strings::eql_case_insensitive_ascii_check_length(func, b"-webkit-repeating-linear-gradient") {
                Ok(Gradient::RepeatingLinear(LinearGradient::parse(input_, VendorPrefix::WEBKIT)?))
            } else if strings::eql_case_insensitive_ascii_check_length(func, b"-webkit-radial-gradient") {
                Ok(Gradient::Radial(RadialGradient::parse(input_, VendorPrefix::WEBKIT)?))
            } else if strings::eql_case_insensitive_ascii_check_length(func, b"-webkit-repeating-radial-gradient") {
                Ok(Gradient::RepeatingRadial(RadialGradient::parse(input_, VendorPrefix::WEBKIT)?))
            } else if strings::eql_case_insensitive_ascii_check_length(func, b"-moz-linear-gradient") {
                Ok(Gradient::Linear(LinearGradient::parse(input_, VendorPrefix::MOZ)?))
            } else if strings::eql_case_insensitive_ascii_check_length(func, b"-moz-repeating-linear-gradient") {
                Ok(Gradient::RepeatingLinear(LinearGradient::parse(input_, VendorPrefix::MOZ)?))
            } else if strings::eql_case_insensitive_ascii_check_length(func, b"-moz-radial-gradient") {
                Ok(Gradient::Radial(RadialGradient::parse(input_, VendorPrefix::MOZ)?))
            } else if strings::eql_case_insensitive_ascii_check_length(func, b"-moz-repeating-radial-gradient") {
                Ok(Gradient::RepeatingRadial(RadialGradient::parse(input_, VendorPrefix::MOZ)?))
            } else if strings::eql_case_insensitive_ascii_check_length(func, b"-o-linear-gradient") {
                Ok(Gradient::Linear(LinearGradient::parse(input_, VendorPrefix::O)?))
            } else if strings::eql_case_insensitive_ascii_check_length(func, b"-o-repeating-linear-gradient") {
                Ok(Gradient::RepeatingLinear(LinearGradient::parse(input_, VendorPrefix::O)?))
            } else if strings::eql_case_insensitive_ascii_check_length(func, b"-o-radial-gradient") {
                Ok(Gradient::Radial(RadialGradient::parse(input_, VendorPrefix::O)?))
            } else if strings::eql_case_insensitive_ascii_check_length(func, b"-o-repeating-radial-gradient") {
                Ok(Gradient::RepeatingRadial(RadialGradient::parse(input_, VendorPrefix::O)?))
            } else if strings::eql_case_insensitive_ascii_check_length(func, b"-webkit-gradient") {
                Ok(Gradient::WebkitGradient(WebKitGradient::parse(input_)?))
            } else {
                Err(location.new_unexpected_token_error(css::Token::Ident(func)))
            }
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        let (f, prefix): (&'static [u8], Option<VendorPrefix>) = match self {
            Gradient::Linear(g) => (b"linear-gradient(", Some(g.vendor_prefix)),
            Gradient::RepeatingLinear(g) => (b"repeating-linear-gradient(", Some(g.vendor_prefix)),
            Gradient::Radial(g) => (b"radial-gradient(", Some(g.vendor_prefix)),
            Gradient::RepeatingRadial(g) => (b"repeating-radial-gradient(", Some(g.vendor_prefix)),
            Gradient::Conic(_) => (b"conic-gradient(", None),
            Gradient::RepeatingConic(_) => (b"repeating-conic-gradient(", None),
            Gradient::WebkitGradient(_) => (b"-webkit-gradient(", None),
        };

        if let Some(p) = prefix {
            p.to_css(dest)?;
        }

        dest.write_str(f)?;

        match self {
            Gradient::Linear(linear) | Gradient::RepeatingLinear(linear) => {
                linear.to_css(dest, linear.vendor_prefix != VendorPrefix::NONE)?;
            }
            Gradient::Radial(radial) | Gradient::RepeatingRadial(radial) => {
                radial.to_css(dest)?;
            }
            Gradient::Conic(conic) | Gradient::RepeatingConic(conic) => {
                conic.to_css(dest)?;
            }
            Gradient::WebkitGradient(g) => {
                g.to_css(dest)?;
            }
        }

        dest.write_char(')')
    }

    /// Attempts to convert the gradient to the legacy `-webkit-gradient()` syntax.
    ///
    /// Returns an error in case the conversion is not possible.
    pub fn get_legacy_webkit(&self, bump: &'bump Arena) -> Option<Gradient<'bump>> {
        Some(Gradient::WebkitGradient(WebKitGradient::from_standard(self, bump)?))
    }

    pub fn deep_clone(&self, bump: &'bump Arena) -> Self {
        match self {
            Gradient::Linear(g) => Gradient::Linear(g.deep_clone(bump)),
            Gradient::RepeatingLinear(g) => Gradient::RepeatingLinear(g.deep_clone(bump)),
            Gradient::Radial(g) => Gradient::Radial(g.deep_clone(bump)),
            Gradient::RepeatingRadial(g) => Gradient::RepeatingRadial(g.deep_clone(bump)),
            Gradient::Conic(g) => Gradient::Conic(g.deep_clone(bump)),
            Gradient::RepeatingConic(g) => Gradient::RepeatingConic(g.deep_clone(bump)),
            Gradient::WebkitGradient(g) => Gradient::WebkitGradient(g.deep_clone(bump)),
        }
    }

    pub fn eql(&self, other: &Gradient) -> bool {
        self == other
    }

    /// Returns the vendor prefix of the gradient.
    pub fn get_vendor_prefix(&self) -> VendorPrefix {
        match self {
            Gradient::Linear(linear) => linear.vendor_prefix,
            Gradient::RepeatingLinear(linear) => linear.vendor_prefix,
            Gradient::Radial(radial) => radial.vendor_prefix,
            Gradient::RepeatingRadial(radial) => radial.vendor_prefix,
            Gradient::WebkitGradient(_) => VendorPrefix::WEBKIT,
            _ => VendorPrefix::NONE,
        }
    }

    /// Returns the vendor prefixes needed for the given browser targets.
    pub fn get_necessary_prefixes(&self, targets: css::targets::Targets) -> VendorPrefix {
        let get_prefixes = |tgts: css::targets::Targets, feature: css::prefixes::Feature, prefix: VendorPrefix| -> VendorPrefix {
            tgts.prefixes(prefix, feature)
        };

        match self {
            Gradient::Linear(linear) => get_prefixes(targets, css::prefixes::Feature::LinearGradient, linear.vendor_prefix),
            Gradient::RepeatingLinear(linear) => get_prefixes(targets, css::prefixes::Feature::RepeatingLinearGradient, linear.vendor_prefix),
            Gradient::Radial(radial) => get_prefixes(targets, css::prefixes::Feature::RadialGradient, radial.vendor_prefix),
            Gradient::RepeatingRadial(radial) => get_prefixes(targets, css::prefixes::Feature::RepeatingRadialGradient, radial.vendor_prefix),
            _ => VendorPrefix::NONE,
        }
    }

    /// Returns a copy of the gradient with the given vendor prefix.
    pub fn get_prefixed(&self, bump: &'bump Arena, prefix: VendorPrefix) -> Gradient<'bump> {
        match self {
            Gradient::Linear(linear) => Gradient::Linear({
                let mut x = linear.deep_clone(bump);
                x.vendor_prefix = prefix;
                x
            }),
            Gradient::RepeatingLinear(linear) => Gradient::RepeatingLinear({
                let mut x = linear.deep_clone(bump);
                x.vendor_prefix = prefix;
                x
            }),
            Gradient::Radial(radial) => Gradient::Radial({
                let mut x = radial.deep_clone(bump);
                x.vendor_prefix = prefix;
                x
            }),
            Gradient::RepeatingRadial(radial) => Gradient::RepeatingRadial({
                let mut x = radial.deep_clone(bump);
                x.vendor_prefix = prefix;
                x
            }),
            _ => self.deep_clone(bump),
        }
    }

    /// Returns a fallback gradient for the given color fallback type.
    pub fn get_fallback(&self, bump: &'bump Arena, kind: css::ColorFallbackKind) -> Gradient<'bump> {
        match self {
            Gradient::Linear(g) => Gradient::Linear(g.get_fallback(bump, kind)),
            Gradient::RepeatingLinear(g) => Gradient::RepeatingLinear(g.get_fallback(bump, kind)),
            Gradient::Radial(g) => Gradient::Radial(g.get_fallback(bump, kind)),
            Gradient::RepeatingRadial(g) => Gradient::RepeatingRadial(g.get_fallback(bump, kind)),
            Gradient::Conic(g) => Gradient::Conic(g.get_fallback(bump, kind)),
            Gradient::RepeatingConic(g) => Gradient::RepeatingConic(g.get_fallback(bump, kind)),
            Gradient::WebkitGradient(g) => Gradient::WebkitGradient(g.get_fallback(bump, kind)),
        }
    }

    /// Returns the color fallback types needed for the given browser targets.
    pub fn get_necessary_fallbacks(&self, targets: css::targets::Targets) -> css::ColorFallbackKind {
        let mut fallbacks = css::ColorFallbackKind::empty();
        match self {
            Gradient::Linear(linear) | Gradient::RepeatingLinear(linear) => {
                for item in linear.items.iter() {
                    fallbacks.insert(item.get_necessary_fallbacks(targets));
                }
            }
            Gradient::Radial(radial) | Gradient::RepeatingRadial(radial) => {
                for item in radial.items.iter() {
                    fallbacks.insert(item.get_necessary_fallbacks(targets));
                }
            }
            Gradient::Conic(conic) | Gradient::RepeatingConic(conic) => {
                for item in conic.items.iter() {
                    fallbacks.insert(item.get_necessary_fallbacks(targets));
                }
            }
            Gradient::WebkitGradient(_) => {}
        }
        fallbacks
    }
}

/// A CSS [`linear-gradient()`](https://www.w3.org/TR/css-images-3/#linear-gradients) or `repeating-linear-gradient()`.
#[derive(PartialEq)]
pub struct LinearGradient<'bump> {
    /// The vendor prefixes for the gradient.
    pub vendor_prefix: VendorPrefix,
    /// The direction of the gradient.
    pub direction: LineDirection,
    /// The color stops and transition hints for the gradient.
    pub items: BumpVec<'bump, GradientItem<LengthPercentage>>,
}

impl<'bump> LinearGradient<'bump> {
    pub fn parse(input: &mut css::Parser<'bump, '_>, vendor_prefix: VendorPrefix) -> Result<LinearGradient<'bump>> {
        let direction: LineDirection = if let Some(dir) = input
            .try_parse(|i| LineDirection::parse(i, vendor_prefix != VendorPrefix::NONE))
            .as_value()
        {
            input.expect_comma()?;
            dir
        } else {
            LineDirection::Vertical(VerticalPositionKeyword::Bottom)
        };
        let items = parse_items::<LengthPercentage>(input)?;
        Ok(LinearGradient { direction, items, vendor_prefix })
    }

    pub fn to_css(&self, dest: &mut Printer, is_prefixed: bool) -> core::result::Result<(), PrintErr> {
        let angle: f32 = match &self.direction {
            LineDirection::Vertical(v) => match v {
                VerticalPositionKeyword::Bottom => 180.0,
                VerticalPositionKeyword::Top => 0.0,
            },
            LineDirection::Angle(a) => a.to_degrees(),
            _ => -1.0,
        };

        // We can omit `to bottom` or `180deg` because it is the default.
        if angle == 180.0 {
            // todo_stuff.depth
            serialize_items::<LengthPercentage>(&self.items, dest)?;
        }
        // If we have `to top` or `0deg`, and all of the positions and hints are percentages,
        // we can flip the gradient the other direction and omit the direction.
        else if angle == 0.0 && dest.minify && 'brk: {
            for item in self.items.iter() {
                match item {
                    GradientItem::Hint(h) if !matches!(h, LengthPercentage::Percentage(_)) => {
                        break 'brk false;
                    }
                    GradientItem::ColorStop(cs)
                        if cs
                            .position
                            .as_ref()
                            .is_some_and(|p| !matches!(p, LengthPercentage::Percentage(_))) =>
                    {
                        break 'brk false;
                    }
                    _ => {}
                }
            }
            true
        } {
            let mut flipped_items: BumpVec<'_, GradientItem<LengthPercentage>> =
                BumpVec::with_capacity_in(self.items.len(), dest.allocator());

            let mut i: usize = self.items.len();
            while i > 0 {
                i -= 1;
                let item = &self.items[i];
                match item {
                    GradientItem::Hint(h) => match h {
                        LengthPercentage::Percentage(p) => flipped_items.push(GradientItem::Hint(
                            LengthPercentage::Percentage(css::css_values::percentage::Percentage { v: 1.0 - p.v }),
                        )),
                        _ => unreachable!(),
                    },
                    GradientItem::ColorStop(cs) => flipped_items.push(GradientItem::ColorStop(ColorStop {
                        color: cs.color.clone(),
                        position: if let Some(p) = &cs.position {
                            match p {
                                LengthPercentage::Percentage(perc) => Some(LengthPercentage::Percentage(
                                    css::css_values::percentage::Percentage { v: 1.0 - perc.v },
                                )),
                                _ => unreachable!(),
                            }
                        } else {
                            None
                        },
                    })),
                }
            }

            if let Err(_) = serialize_items::<LengthPercentage>(&flipped_items, dest) {
                return dest.add_fmt_error();
            }
        } else {
            if !self.direction.eql(&LineDirection::Vertical(VerticalPositionKeyword::Bottom))
                && !self.direction.eql(&LineDirection::Angle(Angle::Deg(180.0)))
            {
                self.direction.to_css(dest, is_prefixed)?;
                dest.delim(',', false)?;
            }

            if let Err(_) = serialize_items::<LengthPercentage>(&self.items, dest) {
                return dest.add_fmt_error();
            }
        }
        Ok(())
    }

    pub fn is_compatible(&self, browsers: css::targets::Browsers) -> bool {
        for item in self.items.iter() {
            if !item.is_compatible(browsers) {
                return false;
            }
        }
        true
    }

    pub fn deep_clone(&self, bump: &'bump Arena) -> Self {
        let mut items: BumpVec<'bump, GradientItem<LengthPercentage>> =
            BumpVec::with_capacity_in(self.items.len(), bump);
        for in_ in self.items.iter() {
            items.push(in_.deep_clone(bump));
        }
        LinearGradient {
            direction: self.direction.deep_clone(bump),
            items,
            vendor_prefix: self.vendor_prefix,
        }
    }

    pub fn eql(&self, other: &LinearGradient) -> bool {
        self == other
    }

    pub fn get_fallback(&self, bump: &'bump Arena, kind: css::ColorFallbackKind) -> LinearGradient<'bump> {
        let mut fallback_items: BumpVec<'bump, GradientItem<LengthPercentage>> =
            BumpVec::with_capacity_in(self.items.len(), bump);
        for in_ in self.items.iter() {
            fallback_items.push(in_.get_fallback(bump, kind));
        }

        LinearGradient {
            direction: self.direction.deep_clone(bump),
            items: fallback_items,
            vendor_prefix: self.vendor_prefix,
        }
    }
}

/// A CSS [`radial-gradient()`](https://www.w3.org/TR/css-images-3/#radial-gradients) or `repeating-radial-gradient()`.
#[derive(PartialEq)]
pub struct RadialGradient<'bump> {
    /// The vendor prefixes for the gradient.
    pub vendor_prefix: VendorPrefix,
    /// The shape of the gradient.
    pub shape: EndingShape,
    /// The position of the gradient.
    pub position: Position,
    /// The color stops and transition hints for the gradient.
    pub items: BumpVec<'bump, GradientItem<LengthPercentage>>,
}

impl<'bump> RadialGradient<'bump> {
    pub fn parse(input: &mut css::Parser<'bump, '_>, vendor_prefix: VendorPrefix) -> Result<RadialGradient<'bump>> {
        // todo_stuff.depth
        let shape = input.try_parse(EndingShape::parse).as_value();
        let position = input
            .try_parse(|input_: &mut css::Parser| -> Result<Position> {
                input_.expect_ident_matching("at")?;
                Position::parse(input_)
            })
            .as_value();

        if shape.is_some() || position.is_some() {
            input.expect_comma()?;
        }

        let items = parse_items::<LengthPercentage>(input)?;
        Ok(RadialGradient {
            // todo_stuff.depth
            shape: shape.unwrap_or_else(EndingShape::default),
            // todo_stuff.depth
            position: position.unwrap_or_else(Position::center),
            items,
            vendor_prefix,
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        if self.shape != EndingShape::default() {
            self.shape.to_css(dest)?;
            if self.position.is_center() {
                dest.delim(',', false)?;
            } else {
                dest.write_char(' ')?;
            }
        }

        if !self.position.is_center() {
            dest.write_str(b"at ")?;
            self.position.to_css(dest)?;
            dest.delim(',', false)?;
        }

        serialize_items::<LengthPercentage>(&self.items, dest)
    }

    pub fn is_compatible(&self, browsers: css::targets::Browsers) -> bool {
        for item in self.items.iter() {
            if !item.is_compatible(browsers) {
                return false;
            }
        }
        true
    }

    pub fn get_fallback(&self, bump: &'bump Arena, kind: css::ColorFallbackKind) -> RadialGradient<'bump> {
        let mut items: BumpVec<'bump, GradientItem<LengthPercentage>> =
            BumpVec::with_capacity_in(self.items.len(), bump);
        for in_ in self.items.iter() {
            items.push(in_.get_fallback(bump, kind));
        }

        RadialGradient {
            shape: self.shape.deep_clone(bump),
            position: self.position.deep_clone(bump),
            items,
            vendor_prefix: self.vendor_prefix,
        }
    }

    pub fn deep_clone(&self, bump: &'bump Arena) -> Self {
        let mut items: BumpVec<'bump, GradientItem<LengthPercentage>> =
            BumpVec::with_capacity_in(self.items.len(), bump);
        for in_ in self.items.iter() {
            items.push(in_.deep_clone(bump));
        }
        RadialGradient {
            shape: self.shape.deep_clone(bump),
            position: self.position.deep_clone(bump),
            items,
            vendor_prefix: self.vendor_prefix,
        }
    }

    pub fn eql(&self, other: &RadialGradient) -> bool {
        self == other
    }
}

/// A CSS [`conic-gradient()`](https://www.w3.org/TR/css-images-4/#conic-gradients) or `repeating-conic-gradient()`.
#[derive(PartialEq)]
pub struct ConicGradient<'bump> {
    /// The angle of the gradient.
    pub angle: Angle,
    /// The position of the gradient.
    pub position: Position,
    /// The color stops and transition hints for the gradient.
    pub items: BumpVec<'bump, GradientItem<AnglePercentage>>,
}

impl<'bump> ConicGradient<'bump> {
    pub fn parse(input: &mut css::Parser<'bump, '_>) -> Result<ConicGradient<'bump>> {
        let angle = input.try_parse(|i: &mut css::Parser| -> Result<Angle> {
            i.expect_ident_matching("from")?;
            // Spec allows unitless zero angles for gradients.
            // https://w3c.github.io/csswg-drafts/css-images-4/#valdef-conic-gradient-angle
            Angle::parse_with_unitless_zero(i)
        });

        let position = input.try_parse(|i: &mut css::Parser| -> Result<Position> {
            i.expect_ident_matching("at")?;
            Position::parse(i)
        });

        if angle.is_ok() || position.is_ok() {
            input.expect_comma()?;
        }

        let items = parse_items::<AnglePercentage>(input)?;
        Ok(ConicGradient {
            angle: angle.unwrap_or(Angle::Deg(0.0)),
            position: position.unwrap_or(Position::center()),
            items,
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        if !self.angle.is_zero() {
            dest.write_str(b"from ")?;
            self.angle.to_css(dest)?;

            if self.position.is_center() {
                dest.delim(',', false)?;
            } else {
                dest.write_char(' ')?;
            }
        }

        if !self.position.is_center() {
            dest.write_str(b"at ")?;
            self.position.to_css(dest)?;
            dest.delim(',', false)?;
        }

        serialize_items::<AnglePercentage>(&self.items, dest)
    }

    pub fn is_compatible(&self, browsers: css::targets::Browsers) -> bool {
        for item in self.items.iter() {
            if !item.is_compatible(browsers) {
                return false;
            }
        }
        true
    }

    pub fn get_fallback(&self, bump: &'bump Arena, kind: css::ColorFallbackKind) -> ConicGradient<'bump> {
        let mut items: BumpVec<'bump, GradientItem<AnglePercentage>> =
            BumpVec::with_capacity_in(self.items.len(), bump);
        for in_ in self.items.iter() {
            items.push(in_.get_fallback(bump, kind));
        }

        ConicGradient {
            angle: self.angle.deep_clone(bump),
            position: self.position.deep_clone(bump),
            items,
        }
    }

    pub fn deep_clone(&self, bump: &'bump Arena) -> Self {
        let mut items: BumpVec<'bump, GradientItem<AnglePercentage>> =
            BumpVec::with_capacity_in(self.items.len(), bump);
        for in_ in self.items.iter() {
            items.push(in_.deep_clone(bump));
        }
        ConicGradient {
            angle: self.angle.deep_clone(bump),
            position: self.position.deep_clone(bump),
            items,
        }
    }

    pub fn eql(&self, other: &ConicGradient) -> bool {
        self == other
    }
}

/// Payload for the `linear` variant of [`WebKitGradient`].
#[derive(PartialEq)]
pub struct WebKitGradientLinear<'bump> {
    /// The starting point of the gradient.
    pub from: WebKitGradientPoint,
    /// The ending point of the gradient.
    pub to: WebKitGradientPoint,
    /// The color stops in the gradient.
    pub stops: BumpVec<'bump, WebKitColorStop>,
}

impl<'bump> WebKitGradientLinear<'bump> {
    pub fn deep_clone(&self, bump: &'bump Arena) -> Self {
        let mut stops: BumpVec<'bump, WebKitColorStop> =
            BumpVec::with_capacity_in(self.stops.len(), bump);
        for in_ in self.stops.iter() {
            stops.push(in_.deep_clone(bump));
        }
        WebKitGradientLinear {
            from: self.from.deep_clone(bump),
            to: self.to.deep_clone(bump),
            stops,
        }
    }
    pub fn eql(&self, other: &Self) -> bool {
        self == other
    }
}

/// Payload for the `radial` variant of [`WebKitGradient`].
#[derive(PartialEq)]
pub struct WebKitGradientRadial<'bump> {
    /// The starting point of the gradient.
    pub from: WebKitGradientPoint,
    /// The starting radius of the gradient.
    pub r0: CSSNumber,
    /// The ending point of the gradient.
    pub to: WebKitGradientPoint,
    /// The ending radius of the gradient.
    pub r1: CSSNumber,
    /// The color stops in the gradient.
    pub stops: BumpVec<'bump, WebKitColorStop>,
}

impl<'bump> WebKitGradientRadial<'bump> {
    pub fn deep_clone(&self, bump: &'bump Arena) -> Self {
        let mut stops: BumpVec<'bump, WebKitColorStop> =
            BumpVec::with_capacity_in(self.stops.len(), bump);
        for in_ in self.stops.iter() {
            stops.push(in_.deep_clone(bump));
        }
        WebKitGradientRadial {
            from: self.from.deep_clone(bump),
            r0: self.r0,
            to: self.to.deep_clone(bump),
            r1: self.r1,
            stops,
        }
    }
    pub fn eql(&self, other: &Self) -> bool {
        self == other
    }
}

/// A legacy `-webkit-gradient()`.
#[derive(PartialEq)]
pub enum WebKitGradient<'bump> {
    /// A linear `-webkit-gradient()`.
    Linear(WebKitGradientLinear<'bump>),
    /// A radial `-webkit-gradient()`.
    Radial(WebKitGradientRadial<'bump>),
}

impl<'bump> WebKitGradient<'bump> {
    pub fn parse(input: &mut css::Parser<'bump, '_>) -> Result<WebKitGradient<'bump>> {
        let location = input.current_source_location();
        let ident = match input.expect_ident() {
            Ok(vv) => vv,
            Err(e) => return Err(e),
        };
        input.expect_comma()?;

        // todo_stuff.match_ignore_ascii_case
        if strings::eql_case_insensitive_ascii_check_length(ident, b"linear") {
            // todo_stuff.depth
            let from = WebKitGradientPoint::parse(input)?;
            input.expect_comma()?;
            let to = WebKitGradientPoint::parse(input)?;
            input.expect_comma()?;
            let stops = input.parse_comma_separated(WebKitColorStop::parse)?;
            Ok(WebKitGradient::Linear(WebKitGradientLinear { from, to, stops }))
        } else if strings::eql_case_insensitive_ascii_check_length(ident, b"radial") {
            let from = WebKitGradientPoint::parse(input)?;
            input.expect_comma()?;
            let r0 = CSSNumberFns::parse(input)?;
            input.expect_comma()?;
            let to = WebKitGradientPoint::parse(input)?;
            input.expect_comma()?;
            let r1 = CSSNumberFns::parse(input)?;
            input.expect_comma()?;
            // todo_stuff.depth
            let stops = input.parse_comma_separated(WebKitColorStop::parse)?;
            Ok(WebKitGradient::Radial(WebKitGradientRadial {
                from,
                r0,
                to,
                r1,
                stops,
            }))
        } else {
            Err(location.new_unexpected_token_error(css::Token::Ident(ident)))
        }
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        match self {
            WebKitGradient::Linear(linear) => {
                dest.write_str(b"linear")?;
                dest.delim(',', false)?;
                linear.from.to_css(dest)?;
                dest.delim(',', false)?;
                linear.to.to_css(dest)?;
                for stop in linear.stops.iter() {
                    dest.delim(',', false)?;
                    stop.to_css(dest)?;
                }
                Ok(())
            }
            WebKitGradient::Radial(radial) => {
                dest.write_str(b"radial")?;
                dest.delim(',', false)?;
                radial.from.to_css(dest)?;
                dest.delim(',', false)?;
                CSSNumberFns::to_css(&radial.r0, dest)?;
                dest.delim(',', false)?;
                radial.to.to_css(dest)?;
                dest.delim(',', false)?;
                CSSNumberFns::to_css(&radial.r1, dest)?;
                for stop in radial.stops.iter() {
                    dest.delim(',', false)?;
                    stop.to_css(dest)?;
                }
                Ok(())
            }
        }
    }

    pub fn get_fallback(&self, bump: &'bump Arena, kind: css::ColorFallbackKind) -> WebKitGradient<'bump> {
        match self {
            WebKitGradient::Linear(linear) => {
                let mut stops: BumpVec<'bump, WebKitColorStop> =
                    BumpVec::with_capacity_in(linear.stops.len(), bump);
                for in_ in linear.stops.iter() {
                    stops.push(in_.get_fallback(bump, kind));
                }
                WebKitGradient::Linear(WebKitGradientLinear {
                    from: linear.from.deep_clone(bump),
                    to: linear.to.deep_clone(bump),
                    stops,
                })
            }
            WebKitGradient::Radial(radial) => {
                let mut stops: BumpVec<'bump, WebKitColorStop> =
                    BumpVec::with_capacity_in(radial.stops.len(), bump);
                for in_ in radial.stops.iter() {
                    stops.push(in_.get_fallback(bump, kind));
                }
                WebKitGradient::Radial(WebKitGradientRadial {
                    from: radial.from.deep_clone(bump),
                    r0: radial.r0,
                    to: radial.to.deep_clone(bump),
                    r1: radial.r1,
                    stops,
                })
            }
        }
    }

    pub fn from_standard(gradient: &Gradient<'bump>, bump: &'bump Arena) -> Option<WebKitGradient<'bump>> {
        match gradient {
            Gradient::Linear(linear) => {
                // Convert from line direction to a from and to point, if possible.
                let (from, to): ((f32, f32), (f32, f32)) = match &linear.direction {
                    LineDirection::Horizontal(horizontal) => match horizontal {
                        HorizontalPositionKeyword::Left => ((1.0, 0.0), (0.0, 0.0)),
                        HorizontalPositionKeyword::Right => ((0.0, 0.0), (1.0, 0.0)),
                    },
                    LineDirection::Vertical(vertical) => match vertical {
                        VerticalPositionKeyword::Top => ((0.0, 1.0), (0.0, 0.0)),
                        VerticalPositionKeyword::Bottom => ((0.0, 0.0), (0.0, 1.0)),
                    },
                    LineDirection::Corner(corner) => match corner.horizontal {
                        HorizontalPositionKeyword::Left => match corner.vertical {
                            VerticalPositionKeyword::Top => ((1.0, 1.0), (0.0, 0.0)),
                            VerticalPositionKeyword::Bottom => ((1.0, 0.0), (0.0, 1.0)),
                        },
                        HorizontalPositionKeyword::Right => match corner.vertical {
                            VerticalPositionKeyword::Top => ((0.0, 1.0), (1.0, 0.0)),
                            VerticalPositionKeyword::Bottom => ((0.0, 0.0), (1.0, 1.0)),
                        },
                    },
                    LineDirection::Angle(angle) => {
                        let degrees = angle.to_degrees();
                        if degrees == 0.0 {
                            ((0.0, 1.0), (0.0, 0.0))
                        } else if degrees == 90.0 {
                            ((0.0, 0.0), (1.0, 0.0))
                        } else if degrees == 180.0 {
                            ((0.0, 0.0), (0.0, 1.0))
                        } else if degrees == 270.0 {
                            ((1.0, 0.0), (0.0, 0.0))
                        } else {
                            return None;
                        }
                    }
                };

                Some(WebKitGradient::Linear(WebKitGradientLinear {
                    from: WebKitGradientPoint {
                        x: WebKitGradientPointComponent::Number(NumberOrPercentage::Percentage(
                            css::css_values::percentage::Percentage { v: from.0 },
                        )),
                        y: WebKitGradientPointComponent::Number(NumberOrPercentage::Percentage(
                            css::css_values::percentage::Percentage { v: from.1 },
                        )),
                    },
                    to: WebKitGradientPoint {
                        x: WebKitGradientPointComponent::Number(NumberOrPercentage::Percentage(
                            css::css_values::percentage::Percentage { v: to.0 },
                        )),
                        y: WebKitGradientPointComponent::Number(NumberOrPercentage::Percentage(
                            css::css_values::percentage::Percentage { v: to.1 },
                        )),
                    },
                    stops: convert_stops_to_webkit(bump, &linear.items)?,
                }))
            }
            Gradient::Radial(radial) => {
                // Webkit radial gradients are always circles, not ellipses, and must be specified in pixels.
                let radius = match &radial.shape {
                    EndingShape::Circle(circle) => match circle {
                        Circle::Radius(r) => match r.to_px() {
                            Some(px) => px,
                            None => return None,
                        },
                        _ => return None,
                    },
                    _ => return None,
                };

                let x = WebKitGradientPointComponent::<HorizontalPositionKeyword>::from_position(&radial.position.x, bump)?;
                let y = WebKitGradientPointComponent::<VerticalPositionKeyword>::from_position(&radial.position.y, bump)?;
                let point = WebKitGradientPoint { x, y };
                Some(WebKitGradient::Radial(WebKitGradientRadial {
                    from: point.deep_clone(bump),
                    r0: 0.0,
                    to: point,
                    r1: radius,
                    stops: convert_stops_to_webkit(bump, &radial.items)?,
                }))
            }
            _ => None,
        }
    }

    pub fn deep_clone(&self, bump: &'bump Arena) -> Self {
        match self {
            WebKitGradient::Linear(l) => WebKitGradient::Linear(l.deep_clone(bump)),
            WebKitGradient::Radial(r) => WebKitGradient::Radial(r.deep_clone(bump)),
        }
    }

    pub fn eql(&self, other: &WebKitGradient) -> bool {
        self == other
    }
}

/// The corner payload for [`LineDirection::Corner`].
#[derive(Clone, PartialEq)]
pub struct LineDirectionCorner {
    /// A horizontal position keyword, e.g. `left` or `right`.
    pub horizontal: HorizontalPositionKeyword,
    /// A vertical position keyword, e.g. `top` or `bottom`.
    pub vertical: VerticalPositionKeyword,
}

impl LineDirectionCorner {
    pub fn deep_clone(&self, _bump: &Arena) -> Self {
        self.clone()
    }
    pub fn eql(&self, other: &Self) -> bool {
        self == other
    }
}

/// The direction of a CSS `linear-gradient()`.
///
/// See [LinearGradient](LinearGradient).
#[derive(Clone, PartialEq)]
pub enum LineDirection {
    /// An angle.
    Angle(Angle),
    /// A horizontal position keyword, e.g. `left` or `right`.
    Horizontal(HorizontalPositionKeyword),
    /// A vertical position keyword, e.g. `top` or `bottom`.
    Vertical(VerticalPositionKeyword),
    /// A corner, e.g. `bottom left` or `top right`.
    Corner(LineDirectionCorner),
}

impl LineDirection {
    pub fn deep_clone(&self, _bump: &Arena) -> Self {
        self.clone()
    }

    pub fn eql(&self, other: &LineDirection) -> bool {
        self == other
    }

    pub fn parse(input: &mut css::Parser, is_prefixed: bool) -> Result<LineDirection> {
        // Spec allows unitless zero angles for gradients.
        // https://w3c.github.io/csswg-drafts/css-images-3/#linear-gradient-syntax
        if let Some(angle) = input.try_parse(Angle::parse_with_unitless_zero).as_value() {
            return Ok(LineDirection::Angle(angle));
        }

        if !is_prefixed {
            input.expect_ident_matching("to")?;
        }

        if let Some(x) = input.try_parse(HorizontalPositionKeyword::parse).as_value() {
            if let Some(y) = input.try_parse(VerticalPositionKeyword::parse).as_value() {
                return Ok(LineDirection::Corner(LineDirectionCorner {
                    horizontal: x,
                    vertical: y,
                }));
            }
            return Ok(LineDirection::Horizontal(x));
        }

        let y = VerticalPositionKeyword::parse(input)?;
        if let Some(x) = input.try_parse(HorizontalPositionKeyword::parse).as_value() {
            return Ok(LineDirection::Corner(LineDirectionCorner {
                horizontal: x,
                vertical: y,
            }));
        }
        Ok(LineDirection::Vertical(y))
    }

    pub fn to_css(&self, dest: &mut Printer, is_prefixed: bool) -> core::result::Result<(), PrintErr> {
        match self {
            LineDirection::Angle(angle) => angle.to_css(dest),
            LineDirection::Horizontal(k) => {
                if dest.minify {
                    dest.write_str(match k {
                        HorizontalPositionKeyword::Left => b"270deg",
                        HorizontalPositionKeyword::Right => b"90deg",
                    })
                } else {
                    if !is_prefixed {
                        dest.write_str(b"to ")?;
                    }
                    k.to_css(dest)
                }
            }
            LineDirection::Vertical(k) => {
                if dest.minify {
                    dest.write_str(match k {
                        VerticalPositionKeyword::Top => b"0deg",
                        VerticalPositionKeyword::Bottom => b"180deg",
                    })
                } else {
                    if !is_prefixed {
                        dest.write_str(b"to ")?;
                    }
                    k.to_css(dest)
                }
            }
            LineDirection::Corner(c) => {
                if !is_prefixed {
                    dest.write_str(b"to ")?;
                }
                c.vertical.to_css(dest)?;
                dest.write_char(' ')?;
                c.horizontal.to_css(dest)
            }
        }
    }
}

/// Either a color stop or interpolation hint within a gradient.
///
/// This type is generic, and items may be either a [LengthPercentage](super::length::LengthPercentage)
/// or [Angle](super::angle::Angle) depending on what type of gradient it is within.
#[derive(Clone, PartialEq)]
pub enum GradientItem<D> {
    /// A color stop.
    ColorStop(ColorStop<D>),
    /// A color interpolation hint.
    Hint(D),
}

impl<D> GradientItem<D>
where
    D: Clone + PartialEq + css::generic::ToCss + css::generic::Parse + css::generic::DeepClone,
    // TODO(port): exact trait bounds for D — Phase B should narrow these.
{
    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        match self {
            GradientItem::ColorStop(c) => c.to_css(dest),
            GradientItem::Hint(h) => css::generic::to_css(h, dest),
        }
    }

    pub fn eql(&self, other: &GradientItem<D>) -> bool {
        self == other
    }

    pub fn deep_clone(&self, bump: &Arena) -> Self {
        match self {
            GradientItem::ColorStop(c) => GradientItem::ColorStop(c.deep_clone(bump)),
            GradientItem::Hint(h) => GradientItem::Hint(h.deep_clone(bump)),
        }
    }

    pub fn is_compatible(&self, browsers: css::targets::Browsers) -> bool {
        match self {
            GradientItem::ColorStop(c) => c.color.is_compatible(browsers),
            GradientItem::Hint(_) => {
                css::compat::Feature::GradientInterpolationHints.is_compatible(browsers)
            }
        }
    }

    /// Returns a fallback gradient item for the given color fallback type.
    pub fn get_fallback(&self, bump: &Arena, kind: css::ColorFallbackKind) -> GradientItem<D> {
        match self {
            GradientItem::ColorStop(stop) => GradientItem::ColorStop(ColorStop {
                color: stop.color.get_fallback(bump, kind),
                position: stop.position.as_ref().map(|p| p.deep_clone(bump)),
            }),
            GradientItem::Hint(_) => self.deep_clone(bump),
        }
    }

    /// Returns the color fallback types needed for the given browser targets.
    pub fn get_necessary_fallbacks(&self, targets: css::targets::Targets) -> css::ColorFallbackKind {
        match self {
            GradientItem::ColorStop(stop) => stop.color.get_necessary_fallbacks(targets),
            GradientItem::Hint(_) => css::ColorFallbackKind::empty(),
        }
    }
}

/// A `radial-gradient()` [ending shape](https://www.w3.org/TR/css-images-3/#valdef-radial-gradient-ending-shape).
///
/// See [RadialGradient](RadialGradient).
#[derive(Clone, PartialEq)]
pub enum EndingShape {
    /// An ellipse.
    Ellipse(Ellipse),
    /// A circle.
    Circle(Circle),
}

impl EndingShape {
    // TODO(port): css.DeriveParse(@This()).parse — derive macro / trait impl.
    pub fn parse(input: &mut css::Parser) -> Result<EndingShape> {
        css::derive_parse::<EndingShape>(input)
    }

    // TODO(port): css.DeriveToCss(@This()).toCss — derive macro / trait impl.
    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        css::derive_to_css(self, dest)
    }

    pub fn default() -> EndingShape {
        EndingShape::Ellipse(Ellipse::Extent(ShapeExtent::FarthestCorner))
    }

    pub fn deep_clone(&self, _bump: &Arena) -> Self {
        self.clone()
    }

    pub fn eql(&self, other: &EndingShape) -> bool {
        self == other
    }
}

/// An x/y position within a legacy `-webkit-gradient()`.
#[derive(Clone, PartialEq)]
pub struct WebKitGradientPoint {
    /// The x-position.
    pub x: WebKitGradientPointComponent<HorizontalPositionKeyword>,
    /// The y-position.
    pub y: WebKitGradientPointComponent<VerticalPositionKeyword>,
}

impl WebKitGradientPoint {
    pub fn parse(input: &mut css::Parser) -> Result<WebKitGradientPoint> {
        let x = WebKitGradientPointComponent::<HorizontalPositionKeyword>::parse(input)?;
        let y = WebKitGradientPointComponent::<VerticalPositionKeyword>::parse(input)?;
        Ok(WebKitGradientPoint { x, y })
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        self.x.to_css(dest)?;
        dest.write_char(' ')?;
        self.y.to_css(dest)
    }

    pub fn eql(&self, other: &WebKitGradientPoint) -> bool {
        self == other
    }

    pub fn deep_clone(&self, _bump: &Arena) -> Self {
        self.clone()
    }
}

/// A keyword or number within a [WebKitGradientPoint](WebKitGradientPoint).
#[derive(Clone, PartialEq)]
pub enum WebKitGradientPointComponent<S> {
    /// The `center` keyword.
    Center,
    /// A number or percentage.
    Number(NumberOrPercentage),
    /// A side keyword.
    Side(S),
}

impl<S> WebKitGradientPointComponent<S>
where
    S: Clone
        + PartialEq
        + css::generic::Parse
        + css::generic::ToCss
        + css::css_values::position::IntoLengthPercentage
        + css::generic::DeepClone,
    // TODO(port): exact trait bounds for S — Phase B should narrow these.
{
    pub fn parse(input: &mut css::Parser) -> Result<Self> {
        if input
            .try_parse(|i| i.expect_ident_matching("center"))
            .is_ok()
        {
            return Ok(WebKitGradientPointComponent::Center);
        }

        if let Some(number) = input.try_parse(NumberOrPercentage::parse).as_value() {
            return Ok(WebKitGradientPointComponent::Number(number));
        }

        let keyword = css::generic::parse::<S>(input)?;
        Ok(WebKitGradientPointComponent::Side(keyword))
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        match self {
            WebKitGradientPointComponent::Center => {
                if dest.minify {
                    dest.write_str(b"50%")
                } else {
                    dest.write_str(b"center")
                }
            }
            WebKitGradientPointComponent::Number(lp) => {
                if matches!(lp, NumberOrPercentage::Percentage(p) if p.v == 0.0) {
                    dest.write_char('0')
                } else {
                    lp.to_css(dest)
                }
            }
            WebKitGradientPointComponent::Side(s) => {
                if dest.minify {
                    let lp: LengthPercentage = s.into_length_percentage();
                    lp.to_css(dest)
                } else {
                    s.to_css(dest)
                }
            }
        }
    }

    /// Attempts to convert a standard position to a webkit gradient point.
    pub fn from_position(this: &PositionComponent<S>, bump: &Arena) -> Option<WebKitGradientPointComponent<S>> {
        match this {
            PositionComponent::Center => Some(WebKitGradientPointComponent::Center),
            PositionComponent::Length(len) => Some(WebKitGradientPointComponent::Number(match len {
                LengthPercentage::Percentage(p) => NumberOrPercentage::Percentage(*p),
                // Webkit gradient points can only be specified in pixels.
                LengthPercentage::Dimension(d) => match d.to_px() {
                    Some(px) => NumberOrPercentage::Number(px),
                    None => return None,
                },
                _ => return None,
            })),
            PositionComponent::Side(s) => {
                if s.offset.is_some() {
                    None
                } else {
                    Some(WebKitGradientPointComponent::Side(s.side.deep_clone(bump)))
                }
            }
        }
    }

    pub fn eql(&self, other: &Self) -> bool {
        self == other
    }
}

/// A color stop within a legacy `-webkit-gradient()`.
#[derive(Clone, PartialEq)]
pub struct WebKitColorStop {
    /// The color of the color stop.
    pub color: CssColor,
    /// The position of the color stop.
    pub position: CSSNumber,
}

impl WebKitColorStop {
    pub fn parse(input: &mut css::Parser) -> Result<WebKitColorStop> {
        let location = input.current_source_location();
        let function = match input.expect_function() {
            Ok(vv) => vv,
            Err(e) => return Err(e),
        };
        input.parse_nested_block(|i: &mut css::Parser| -> Result<WebKitColorStop> {
            // todo_stuff.match_ignore_ascii_case
            let position: f32 = if strings::eql_case_insensitive_ascii_check_length(function, b"color-stop") {
                let p: NumberOrPercentage = NumberOrPercentage::parse(i)?;
                i.expect_comma()?;
                p.into_f32()
            } else if strings::eql_case_insensitive_ascii_check_length(function, b"from") {
                0.0
            } else if strings::eql_case_insensitive_ascii_check_length(function, b"to") {
                1.0
            } else {
                return Err(location.new_unexpected_token_error(css::Token::Ident(function)));
            };
            let color = CssColor::parse(i)?;
            Ok(WebKitColorStop { color, position })
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        if self.position == 0.0 {
            dest.write_str(b"from(")?;
            self.color.to_css(dest)?;
        } else if self.position == 1.0 {
            dest.write_str(b"to(")?;
            self.color.to_css(dest)?;
        } else {
            dest.write_str(b"color-stop(")?;
            css::generic::to_css(&self.position, dest)?;
            dest.delim(',', false)?;
            self.color.to_css(dest)?;
        }
        dest.write_char(')')
    }

    pub fn get_fallback(&self, bump: &Arena, kind: css::ColorFallbackKind) -> WebKitColorStop {
        WebKitColorStop {
            color: self.color.get_fallback(bump, kind),
            position: self.position,
        }
    }

    pub fn deep_clone(&self, _bump: &Arena) -> Self {
        self.clone()
    }

    pub fn eql(&self, other: &WebKitColorStop) -> bool {
        self == other
    }
}

/// A [`<color-stop>`](https://www.w3.org/TR/css-images-4/#color-stop-syntax) within a gradient.
///
/// This type is generic, and may be either a [LengthPercentage](super::length::LengthPercentage)
/// or [Angle](super::angle::Angle) depending on what type of gradient it is within.
#[derive(Clone, PartialEq)]
pub struct ColorStop<D> {
    /// The color of the color stop.
    pub color: CssColor,
    /// The position of the color stop.
    pub position: Option<D>,
}

impl<D> ColorStop<D>
where
    D: Clone + PartialEq + css::generic::ToCss + css::generic::Parse,
    // TODO(port): exact trait bounds for D — Phase B should narrow these.
{
    pub fn parse(input: &mut css::Parser) -> Result<ColorStop<D>> {
        let color = CssColor::parse(input)?;
        let position = input.try_parse(css::generic::parse_for::<D>).as_value();
        Ok(ColorStop { color, position })
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        self.color.to_css(dest)?;
        if let Some(position) = &self.position {
            dest.write_char(' ')?;
            css::generic::to_css(position, dest)?;
        }
        Ok(())
    }

    pub fn deep_clone(&self, _bump: &Arena) -> Self {
        self.clone()
    }

    pub fn eql(&self, other: &Self) -> bool {
        self == other
    }
}

/// Payload for [`Ellipse::Size`].
#[derive(Clone, PartialEq)]
pub struct EllipseSize {
    /// The x-radius of the ellipse.
    pub x: LengthPercentage,
    /// The y-radius of the ellipse.
    pub y: LengthPercentage,
}

impl EllipseSize {
    pub fn deep_clone(&self, _bump: &Arena) -> Self {
        self.clone()
    }
    pub fn eql(&self, other: &Self) -> bool {
        self == other
    }
}

/// An ellipse ending shape for a `radial-gradient()`.
///
/// See [RadialGradient](RadialGradient).
#[derive(Clone, PartialEq)]
pub enum Ellipse {
    /// An ellipse with a specified horizontal and vertical radius.
    Size(EllipseSize),
    /// A shape extent keyword.
    Extent(ShapeExtent),
}

impl Ellipse {
    pub fn parse(input: &mut css::Parser) -> Result<Ellipse> {
        if let Some(extent) = input.try_parse(ShapeExtent::parse).as_value() {
            // The `ellipse` keyword is optional, but only if the `circle` keyword is not present.
            // If it is, then we'll re-parse as a circle.
            if input
                .try_parse(|i| i.expect_ident_matching("circle"))
                .is_ok()
            {
                return Err(input.new_error_for_next_token());
            }
            let _ = input.try_parse(|i| i.expect_ident_matching("ellipse"));
            return Ok(Ellipse::Extent(extent));
        }

        if let Some(x) = input.try_parse(LengthPercentage::parse).as_value() {
            let y = LengthPercentage::parse(input)?;
            // The `ellipse` keyword is optional if there are two lengths.
            let _ = input.try_parse(|i| i.expect_ident_matching("ellipse"));
            return Ok(Ellipse::Size(EllipseSize { x, y }));
        }

        if input
            .try_parse(|i| i.expect_ident_matching("ellipse"))
            .is_ok()
        {
            if let Some(extent) = input.try_parse(ShapeExtent::parse).as_value() {
                return Ok(Ellipse::Extent(extent));
            }

            if let Some(x) = input.try_parse(LengthPercentage::parse).as_value() {
                let y = LengthPercentage::parse(input)?;
                return Ok(Ellipse::Size(EllipseSize { x, y }));
            }

            // Assume `farthest-corner` if only the `ellipse` keyword is present.
            return Ok(Ellipse::Extent(ShapeExtent::FarthestCorner));
        }

        Err(input.new_error_for_next_token())
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        // The `ellipse` keyword is optional, so we don't emit it.
        match self {
            Ellipse::Size(s) => {
                s.x.to_css(dest)?;
                dest.write_char(' ')?;
                s.y.to_css(dest)
            }
            Ellipse::Extent(e) => e.to_css(dest),
        }
    }

    pub fn deep_clone(&self, _bump: &Arena) -> Self {
        self.clone()
    }

    pub fn eql(&self, other: &Ellipse) -> bool {
        self == other
    }
}

#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum ShapeExtent {
    /// The closest side of the box to the gradient's center.
    #[strum(serialize = "closest-side")]
    ClosestSide,
    /// The farthest side of the box from the gradient's center.
    #[strum(serialize = "farthest-side")]
    FarthestSide,
    /// The closest corner of the box to the gradient's center.
    #[strum(serialize = "closest-corner")]
    ClosestCorner,
    /// The farthest corner of the box from the gradient's center.
    #[strum(serialize = "farthest-corner")]
    FarthestCorner,
}

impl ShapeExtent {
    pub fn eql(&self, other: &ShapeExtent) -> bool {
        *self == *other
    }

    pub fn as_str(&self) -> &'static [u8] {
        css::enum_property_util::as_str(self)
    }

    pub fn parse(input: &mut css::Parser) -> Result<Self> {
        css::enum_property_util::parse::<Self>(input)
    }

    pub fn deep_clone(&self, _bump: &Arena) -> Self {
        *self
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        css::enum_property_util::to_css(self, dest)
    }
}

/// A circle ending shape for a `radial-gradient()`.
///
/// See [RadialGradient](RadialGradient).
#[derive(Clone, PartialEq)]
pub enum Circle {
    /// A circle with a specified radius.
    Radius(Length),
    /// A shape extent keyword.
    Extent(ShapeExtent),
}

impl Circle {
    pub fn parse(input: &mut css::Parser) -> Result<Circle> {
        if let Some(extent) = input.try_parse(ShapeExtent::parse).as_value() {
            // The `circle` keyword is required. If it's not there, then it's an ellipse.
            input.expect_ident_matching("circle")?;
            return Ok(Circle::Extent(extent));
        }

        if let Some(length) = input.try_parse(Length::parse).as_value() {
            // The `circle` keyword is optional if there is only a single length.
            // We are assuming here that Ellipse.parse ran first.
            let _ = input.try_parse(|i| i.expect_ident_matching("circle"));
            return Ok(Circle::Radius(length));
        }

        if input
            .try_parse(|i| i.expect_ident_matching("circle"))
            .is_ok()
        {
            if let Some(extent) = input.try_parse(ShapeExtent::parse).as_value() {
                return Ok(Circle::Extent(extent));
            }

            if let Some(length) = input.try_parse(Length::parse).as_value() {
                return Ok(Circle::Radius(length));
            }

            // If only the `circle` keyword was given, default to `farthest-corner`.
            return Ok(Circle::Extent(ShapeExtent::FarthestCorner));
        }

        Err(input.new_error_for_next_token())
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        match self {
            Circle::Radius(r) => r.to_css(dest),
            Circle::Extent(extent) => {
                dest.write_str(b"circle")?;
                if *extent != ShapeExtent::FarthestCorner {
                    dest.write_char(' ')?;
                    extent.to_css(dest)?;
                }
                Ok(())
            }
        }
    }

    pub fn deep_clone(&self, _bump: &Arena) -> Self {
        self.clone()
    }

    pub fn eql(&self, other: &Circle) -> bool {
        self == other
    }
}

pub fn parse_items<'bump, D>(input: &mut css::Parser<'bump, '_>) -> Result<BumpVec<'bump, GradientItem<D>>>
where
    D: Clone + PartialEq + css::generic::ToCss + css::generic::Parse + css::generic::DeepClone,
    // TODO(port): exact trait bounds for D — Phase B should narrow these.
{
    let mut items: BumpVec<'bump, GradientItem<D>> = BumpVec::new_in(input.allocator());
    let mut seen_stop = false;

    loop {
        // PORT NOTE: reshaped for borrowck — Zig used a Closure { items: *ArrayList, seen_stop: *bool }
        // captured into parseUntilBefore; here we close over &mut locals directly.
        input.parse_until_before(css::Delimiters::COMMA, |i: &mut css::Parser| -> Result<()> {
            if seen_stop {
                if let Some(hint) = i.try_parse(css::generic::parse_for::<D>).as_value() {
                    seen_stop = false;
                    items.push(GradientItem::Hint(hint));
                    return Ok(());
                }
            }

            let stop = ColorStop::<D>::parse(i)?;

            if let Some(position) = i.try_parse(css::generic::parse_for::<D>).as_value() {
                let color = stop.color.deep_clone(i.allocator());
                items.push(GradientItem::ColorStop(stop));
                items.push(GradientItem::ColorStop(ColorStop {
                    color,
                    position: Some(position),
                }));
            } else {
                items.push(GradientItem::ColorStop(stop));
            }

            seen_stop = true;
            Ok(())
        })?;

        if let Some(tok) = input.next().as_value() {
            if matches!(tok, css::Token::Comma) {
                continue;
            }
            unreachable!("expected a comma after parsing a gradient");
        } else {
            break;
        }
    }

    Ok(items)
}

pub fn serialize_items<'bump, D>(
    items: &BumpVec<'bump, GradientItem<D>>,
    dest: &mut Printer,
) -> core::result::Result<(), PrintErr>
where
    D: Clone + PartialEq + css::generic::ToCss + css::generic::Parse + css::generic::DeepClone,
    // TODO(port): exact trait bounds for D — Phase B should narrow these.
    // TODO(port): `item.hint == .percentage` check below assumes D has a Percentage variant;
    // in Zig this is comptime-dispatched per monomorphization. Phase B may need a trait method.
{
    let mut first = true;
    let mut last: Option<&GradientItem<D>> = None;
    for item in items.iter() {
        // Skip useless hints
        if let GradientItem::Hint(h) = item {
            // TODO(port): generic check `h == .percentage && h.percentage.v == 0.5` — needs trait on D
            if css::generic::is_percentage_with_value(h, 0.5) {
                continue;
            }
        }

        // Use double position stop if the last stop is the same color and all targets support it.
        if let Some(prev) = last {
            if !dest.targets.should_compile(
                css::compat::Feature::DoublePositionGradients,
                css::compat::Features::DOUBLE_POSITION_GRADIENTS,
            ) {
                if let (GradientItem::ColorStop(prev_cs), GradientItem::ColorStop(item_cs)) = (prev, item) {
                    if prev_cs.position.is_some()
                        && item_cs.position.is_some()
                        && prev_cs.color.eql(&item_cs.color)
                    {
                        dest.write_char(' ')?;
                        item_cs.position.as_ref().unwrap().to_css(dest)?;
                        last = None;
                        continue;
                    }
                }
            }
        }

        if first {
            first = false;
        } else {
            dest.delim(',', false)?;
        }
        item.to_css(dest)?;
        last = Some(item);
    }
    Ok(())
}

pub fn convert_stops_to_webkit<'bump>(
    bump: &'bump Arena,
    items: &BumpVec<'bump, GradientItem<LengthPercentage>>,
) -> Option<BumpVec<'bump, WebKitColorStop>> {
    let mut stops: BumpVec<'bump, WebKitColorStop> = BumpVec::with_capacity_in(items.len(), bump);
    for (i, item) in items.iter().enumerate() {
        match item {
            GradientItem::ColorStop(stop) => {
                // webkit stops must always be percentage based, not length based.
                let position: f32 = if let Some(pos) = &stop.position {
                    match pos {
                        LengthPercentage::Percentage(percentage) => percentage.v,
                        _ => {
                            return None;
                        }
                    }
                } else if i == 0 {
                    0.0
                } else if i == items.len() - 1 {
                    1.0
                } else {
                    return None;
                };

                stops.push(WebKitColorStop {
                    color: stop.color.deep_clone(bump),
                    position,
                });
            }
            _ => return None,
        }
    }

    Some(stops)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/values/gradient.zig (1657 lines)
//   confidence: medium
//   todos:      8
//   notes:      Arena-backed (BumpVec<'bump>) per §Allocators; bump threaded through deep_clone/get_fallback/get_prefixed/from_standard/from_position. parse_items/to_css obtain arena via input.allocator()/dest.allocator(). serialize_items needs trait for generic .percentage check. EndingShape parse/to_css use placeholder derive helpers. ComptimeEnumMap getAnyCase → if-chain.
// ──────────────────────────────────────────────────────────────────────────
