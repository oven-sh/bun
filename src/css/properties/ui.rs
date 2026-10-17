#![warn(unused_must_use)]
use crate as css;

use css::css_properties::Property;
use css::{PrintErr, Printer, PropertyHandlerContext};

use css::css_values::ident::DashedIdent;

// bumpalo::Bump re-export (CSS is an arena crate)

bitflags::bitflags! {
    /// A value for the [color-scheme](https://drafts.csswg.org/css-color-adjust/#color-scheme-prop) property.
    #[derive(Clone, Copy, PartialEq, Eq, Default)]
    pub struct ColorScheme: u8 {
        /// Indicates that the element supports a light color scheme.
        const LIGHT = 1 << 0;
        /// Indicates that the element supports a dark color scheme.
        const DARK  = 1 << 1;
        /// Forbids the user agent from overriding the color scheme for the element.
        const ONLY  = 1 << 2;
    }
}

impl ColorScheme {
    pub(crate) fn parse(input: &mut css::Parser) -> css::Result<ColorScheme> {
        let mut res = ColorScheme::empty();
        let ident = input.expect_ident_cloned()?;

        if let Some(value) = color_scheme_map_get(ident) {
            match value {
                ColorSchemeKeyword::Normal => return Ok(res),
                ColorSchemeKeyword::Only => res.insert(ColorScheme::ONLY),
                ColorSchemeKeyword::Light => res.insert(ColorScheme::LIGHT),
                ColorSchemeKeyword::Dark => res.insert(ColorScheme::DARK),
            }
        }

        while let Ok(i) = input.try_parse(|p| p.expect_ident_cloned()) {
            if let Some(value) = color_scheme_map_get(i) {
                match value {
                    ColorSchemeKeyword::Normal => {
                        return Err(input.new_custom_error(css::ParserError::invalid_value));
                    }
                    ColorSchemeKeyword::Only => {
                        // Only must be at the start or the end, not in the middle
                        if res.contains(ColorScheme::ONLY) {
                            return Err(input.new_custom_error(css::ParserError::invalid_value));
                        }
                        res.insert(ColorScheme::ONLY);
                        return Ok(res);
                    }
                    ColorSchemeKeyword::Light => res.insert(ColorScheme::LIGHT),
                    ColorSchemeKeyword::Dark => res.insert(ColorScheme::DARK),
                }
            }
        }

        Ok(res)
    }

    pub(crate) fn to_css(self, dest: &mut Printer) -> Result<(), PrintErr> {
        if self == ColorScheme::empty() {
            return dest.write_str("normal");
        }

        if self.contains(ColorScheme::LIGHT) {
            dest.write_str("light")?;
            if self.contains(ColorScheme::DARK) {
                dest.write_char(b' ')?;
            }
        }

        if self.contains(ColorScheme::DARK) {
            dest.write_str("dark")?;
        }

        if self.contains(ColorScheme::ONLY) {
            dest.write_str(" only")?;
        }

        Ok(())
    }
}

// ≤8 entries → plain match on bytes.
#[derive(Clone, Copy)]
enum ColorSchemeKeyword {
    Normal,
    Only,
    Light,
    Dark,
}

fn color_scheme_map_get(ident: &[u8]) -> Option<ColorSchemeKeyword> {
    match ident {
        b"normal" => Some(ColorSchemeKeyword::Normal),
        b"only" => Some(ColorSchemeKeyword::Only),
        b"light" => Some(ColorSchemeKeyword::Light),
        b"dark" => Some(ColorSchemeKeyword::Dark),
        _ => None,
    }
}

#[derive(Default)]
pub struct ColorSchemeHandler;

// `define_var` needs no arena because `TokenList.v` is a std `Vec<TokenOrValue>`.
impl ColorSchemeHandler {
    pub(crate) fn handle_property(
        &mut self,
        property: &Property,
        dest: &mut css::DeclarationList,
        context: &mut PropertyHandlerContext,
    ) -> bool {
        match property {
            Property::ColorScheme(color_scheme_) => {
                let color_scheme: ColorScheme = *color_scheme_;
                if !context
                    .targets
                    .is_compatible(css::compat::Feature::LightDark)
                {
                    if color_scheme.contains(ColorScheme::LIGHT) {
                        dest.push(define_var(b"--buncss-light", css::Token::Ident(b"initial")));
                        dest.push(define_var(b"--buncss-dark", css::Token::Whitespace(b" ")));

                        if color_scheme.contains(ColorScheme::DARK) {
                            context.add_dark_rule(define_var(
                                b"--buncss-light",
                                css::Token::Whitespace(b" "),
                            ));
                            context.add_dark_rule(define_var(
                                b"--buncss-dark",
                                css::Token::Ident(b"initial"),
                            ));
                        }
                    } else if color_scheme.contains(ColorScheme::DARK) {
                        dest.push(define_var(b"--buncss-light", css::Token::Whitespace(b" ")));
                        dest.push(define_var(b"--buncss-dark", css::Token::Ident(b"initial")));
                    }
                }
                // ColorScheme is `Copy` (bitflags u8), so reconstruct the variant directly.
                dest.push(Property::ColorScheme(color_scheme));
                true
            }
            _ => false,
        }
    }

    pub(crate) fn finalize(
        &mut self,
        _: &mut css::DeclarationList<'_>,
        _: &mut PropertyHandlerContext<'_>,
    ) {
    }
}

fn define_var(name: &'static [u8], value: css::Token) -> Property {
    // `name` is `&'static [u8]` because all call sites pass byte-string literals.
    // `TokenList.v` is `Vec<TokenOrValue>` (std Vec — see custom.rs:320), so no arena
    // threading is needed here.
    Property::Custom(css::css_properties::custom::CustomProperty {
        name: css::css_properties::custom::CustomPropertyName::Custom(DashedIdent { v: name }),
        value: css::TokenList {
            v: vec![css::css_properties::custom::TokenOrValue::Token(value)],
        },
    })
}

/// A value for the [caret-color](https://www.w3.org/TR/2021/WD-css-ui-4-20210316/#caret-color) property.
pub enum ColorOrAuto {
    /// The `currentColor`, adjusted by the UA to ensure contrast against the background.
    Auto,
    /// A color.
    Color(css::css_values::color::CssColor),
}

impl ColorOrAuto {
    pub(crate) fn parse(input: &mut css::Parser) -> css::Result<Self> {
        if input
            .try_parse(|p| p.expect_ident_matching(b"auto"))
            .is_ok()
        {
            return Ok(ColorOrAuto::Auto);
        }
        css::css_values::color::CssColor::parse(input).map(ColorOrAuto::Color)
    }

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            ColorOrAuto::Auto => dest.write_str("auto"),
            ColorOrAuto::Color(color) => color.to_css(dest),
        }
    }

    pub(crate) fn deep_clone(&self, arena: &bun_alloc::Arena) -> Self {
        match self {
            ColorOrAuto::Auto => ColorOrAuto::Auto,
            ColorOrAuto::Color(color) => ColorOrAuto::Color(color.deep_clone(arena)),
        }
    }

    pub(crate) fn eql(&self, rhs: &Self) -> bool {
        use css::generics::CssEql as _;
        match (self, rhs) {
            (ColorOrAuto::Auto, ColorOrAuto::Auto) => true,
            (ColorOrAuto::Color(a), ColorOrAuto::Color(b)) => a.eql(b),
            _ => false,
        }
    }

    fn is_auto(&self) -> bool {
        matches!(self, ColorOrAuto::Auto)
    }

    /// Returns the RGB and P3 fallbacks the color needs for `targets`, and lowers `self`
    /// to LAB in place when that is needed too (see `CssColor::get_fallbacks`).
    pub(crate) fn get_fallbacks(
        &mut self,
        arena: &bun_alloc::Arena,
        targets: &css::targets::Targets,
    ) -> css::SmallList<ColorOrAuto, 2> {
        let mut res = css::SmallList::<ColorOrAuto, 2>::default();
        if let ColorOrAuto::Color(color) = self {
            for fb in color.get_fallbacks(arena, targets).slice() {
                res.append(ColorOrAuto::Color(fb.deep_clone(arena)));
            }
        }
        res
    }

    pub(crate) fn is_compatible(&self, browsers: &css::targets::Browsers) -> bool {
        match self {
            ColorOrAuto::Auto => true,
            ColorOrAuto::Color(color) => color.is_compatible(browsers),
        }
    }
}

/// A value for the [caret-shape](https://www.w3.org/TR/2021/WD-css-ui-4-20210316/#caret-shape) property.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, crate::DefineEnumProperty, crate::generics::CssHash,
)]
pub enum CaretShape {
    /// The UA determines the caret shape.
    Auto,
    /// A thin bar caret.
    Bar,
    /// A rectangle caret.
    Block,
    /// An underscore caret.
    Underscore,
}

/// A value for the [caret](https://www.w3.org/TR/2021/WD-css-ui-4-20210316/#caret) shorthand property.
pub struct Caret {
    /// The caret color.
    pub(crate) color: ColorOrAuto,
    /// The caret shape.
    pub(crate) shape: CaretShape,
}

impl Caret {
    /// Either part may come first or be omitted, and an omitted part is `auto`. The
    /// color is tried first, so a lone or leading `auto` is the color (as in lightningcss).
    pub(crate) fn parse(input: &mut css::Parser) -> css::Result<Self> {
        let mut color: Option<ColorOrAuto> = None;
        let mut shape: Option<CaretShape> = None;
        loop {
            if color.is_none() {
                if let Ok(c) = input.try_parse(ColorOrAuto::parse) {
                    color = Some(c);
                    continue;
                }
            }
            if shape.is_none() {
                if let Ok(s) = input.try_parse(CaretShape::parse) {
                    shape = Some(s);
                    continue;
                }
            }
            break;
        }
        if color.is_none() && shape.is_none() {
            return Err(input.new_error(css::BasicParseErrorKind::qualified_rule_invalid));
        }
        Ok(Caret {
            color: color.unwrap_or(ColorOrAuto::Auto),
            shape: shape.unwrap_or(CaretShape::Auto),
        })
    }

    /// Prints the parts that aren't `auto`, or `auto` when both are.
    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        let show_shape = self.shape != CaretShape::Auto;
        if !self.color.is_auto() {
            self.color.to_css(dest)?;
            if show_shape {
                dest.write_char(b' ')?;
            }
        } else if !show_shape {
            return dest.write_str("auto");
        }
        if show_shape {
            self.shape.to_css(dest)?;
        }
        Ok(())
    }

    pub(crate) fn deep_clone(&self, arena: &bun_alloc::Arena) -> Self {
        Caret {
            color: self.color.deep_clone(arena),
            shape: self.shape,
        }
    }

    pub(crate) fn eql(&self, rhs: &Self) -> bool {
        self.color.eql(&rhs.color) && self.shape == rhs.shape
    }

    pub(crate) fn get_fallbacks(
        &mut self,
        arena: &bun_alloc::Arena,
        targets: &css::targets::Targets,
    ) -> css::SmallList<Caret, 2> {
        let shape = self.shape;
        let mut res = css::SmallList::<Caret, 2>::default();
        for color in self
            .color
            .get_fallbacks(arena, targets)
            .to_owned_slice()
            .into_vec()
        {
            res.append(Caret { color, shape });
        }
        res
    }

    pub(crate) fn is_compatible(&self, browsers: &css::targets::Browsers) -> bool {
        self.color.is_compatible(browsers)
    }
}

macro_rules! forward_generics {
    ($($T:ty),+) => {$(
        impl<'bump> css::generic::DeepClone<'bump> for $T {
            #[inline]
            fn deep_clone(&self, bump: &'bump bun_alloc::Arena) -> Self {
                <$T>::deep_clone(self, bump)
            }
        }
        impl css::generic::CssEql for $T {
            #[inline]
            fn eql(&self, other: &Self) -> bool {
                <$T>::eql(self, other)
            }
        }
        impl css::generic::IsCompatible for $T {
            #[inline]
            fn is_compatible(&self, browsers: &css::targets::Browsers) -> bool {
                <$T>::is_compatible(self, browsers)
            }
        }
    )+};
}
forward_generics!(ColorOrAuto, Caret);
