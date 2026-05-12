#![allow(unused_imports, dead_code, unused_macros)]
#![warn(unused_must_use)]
use crate as css;
use crate::css_properties::custom::UnparsedProperty;
use crate::css_values::color::{ColorFallbackKind, CssColor};
use crate::css_values::length::Length;
use crate::properties::{Property, PropertyId, PropertyIdTag};
use crate::targets::Browsers;
use crate::{
    DeclarationList, Feature, Parser, ParserError, PrintErr, Printer, PropertyCategory,
    PropertyHandlerContext, Result as CssResult, SmallList, Targets,
};
use bun_alloc::ArenaVecExt as _;

use super::border_image::BorderImageHandler;
use super::border_radius::BorderRadiusHandler;

use bun_alloc::Arena as Bump;

// ──────────────────────────────────────────────────────────────────────────
// Shorthand type aliases
// ──────────────────────────────────────────────────────────────────────────

/// A value for the [border-top](https://www.w3.org/TR/css-backgrounds-3/#propdef-border-top) shorthand property.
pub type BorderTop = GenericBorder<LineStyle, 0>;
/// A value for the [border-right](https://www.w3.org/TR/css-backgrounds-3/#propdef-border-right) shorthand property.
pub type BorderRight = GenericBorder<LineStyle, 1>;
/// A value for the [border-bottom](https://www.w3.org/TR/css-backgrounds-3/#propdef-border-bottom) shorthand property.
pub type BorderBottom = GenericBorder<LineStyle, 2>;
/// A value for the [border-left](https://www.w3.org/TR/css-backgrounds-3/#propdef-border-left) shorthand property.
pub type BorderLeft = GenericBorder<LineStyle, 3>;
/// A value for the [border-block-start](https://drafts.csswg.org/css-logical/#propdef-border-block-start) shorthand property.
pub type BorderBlockStart = GenericBorder<LineStyle, 4>;
/// A value for the [border-block-end](https://drafts.csswg.org/css-logical/#propdef-border-block-end) shorthand property.
pub type BorderBlockEnd = GenericBorder<LineStyle, 5>;
/// A value for the [border-inline-start](https://drafts.csswg.org/css-logical/#propdef-border-inline-start) shorthand property.
pub type BorderInlineStart = GenericBorder<LineStyle, 6>;
/// A value for the [border-inline-end](https://drafts.csswg.org/css-logical/#propdef-border-inline-end) shorthand property.
pub type BorderInlineEnd = GenericBorder<LineStyle, 7>;
/// A value for the [border-block](https://drafts.csswg.org/css-logical/#propdef-border-block) shorthand property.
pub type BorderBlock = GenericBorder<LineStyle, 8>;
/// A value for the [border-inline](https://drafts.csswg.org/css-logical/#propdef-border-inline) shorthand property.
pub type BorderInline = GenericBorder<LineStyle, 9>;
/// A value for the [border](https://www.w3.org/TR/css-backgrounds-3/#propdef-border) shorthand property.
pub type Border = GenericBorder<LineStyle, 10>;

// ──────────────────────────────────────────────────────────────────────────
// GenericBorder
// ──────────────────────────────────────────────────────────────────────────

/// A generic type that represents the `border` and `outline` shorthand properties.
#[derive(Clone)]
pub struct GenericBorder<S, const P: u8> {
    /// The width of the border.
    pub width: BorderSideWidth,
    /// The border style.
    pub style: S,
    /// The border color.
    pub color: CssColor,
}

impl<S, const P: u8> super::GenericBorderImpl for GenericBorder<S, P>
where
    S: css::generic::Parse + css::generic::ToCss + Default + PartialEq,
{
    fn parse(input: &mut Parser) -> CssResult<Self> {
        // Order doesn't matter
        let mut color: Option<CssColor> = None;
        let mut style: Option<S> = None;
        let mut width: Option<BorderSideWidth> = None;
        let mut any = false;

        loop {
            if width.is_none() {
                if let Ok(value) = input.try_parse(BorderSideWidth::parse) {
                    width = Some(value);
                    any = true;
                }
            }

            if style.is_none() {
                if let Ok(value) = input.try_parse(<S as css::generic::Parse>::parse) {
                    style = Some(value);
                    any = true;
                    continue;
                }
            }

            if color.is_none() {
                if let Ok(value) = input.try_parse(CssColor::parse) {
                    color = Some(value);
                    any = true;
                    continue;
                }
            }
            break;
        }

        if any {
            return Ok(Self {
                width: width.unwrap_or(BorderSideWidth::Medium),
                style: style.unwrap_or_default(),
                color: color.unwrap_or(CssColor::CurrentColor),
            });
        }

        Err(input.new_custom_error(css::ParserError::invalid_declaration))
    }

    fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        let default_style = S::default();
        if self.width == BorderSideWidth::Medium
            && self.style == default_style
            && self.color == CssColor::CurrentColor
        {
            return self.style.to_css(dest);
        }

        let mut needs_space = false;
        if self.width != BorderSideWidth::default() {
            self.width.to_css(dest)?;
            needs_space = true;
        }
        if self.style != default_style {
            if needs_space {
                dest.write_str(b" ")?;
            }
            self.style.to_css(dest)?;
            needs_space = true;
        }
        if self.color != CssColor::CurrentColor {
            if needs_space {
                dest.write_str(b" ")?;
            }
            self.color.to_css(dest)?;
            #[allow(unused_assignments)]
            {
                needs_space = true;
            }
        }
        Ok(())
    }
}

impl<S, const P: u8> GenericBorder<S, P>
where
    S: css::generic::Parse
        + css::generic::ToCss
        + Default
        + PartialEq
        + for<'b> css::generics::DeepClone<'b>
        + css::generics::CssEql,
{
    fn get_fallbacks(&mut self, arena: &Bump, targets: Targets) -> SmallList<Self, 2> {
        use css::generics::DeepClone as _;
        let fallbacks = self.color.get_fallbacks(arena, targets);
        // PERF(port): was arena bulk-free (fallbacks.deinit) — profile in Phase B
        let mut out: SmallList<Self, 2> = SmallList::init_capacity(fallbacks.len());
        for color in fallbacks.slice() {
            out.append_assume_capacity(Self {
                color: color.clone(),
                width: self.width.deep_clone(arena),
                style: self.style.deep_clone(arena),
            });
        }

        out
    }

    pub fn deep_clone(&self, arena: &Bump) -> Self {
        css::implement_deep_clone(self, arena)
    }

    /// Deep-clone into a `GenericBorder` with a different const-generic
    /// discriminant `Q`. The fields are identical regardless of `P`; this is
    /// the Rust equivalent of Zig coercing one anonymous struct literal into
    /// multiple `Border*` aliases. Needed when one logical value must be
    /// emitted as two distinct physical `Property` variants (e.g.
    /// inline-start → BorderLeft + BorderRight).
    pub fn clone_as<const Q: u8>(&self, arena: &Bump) -> GenericBorder<S, Q> {
        let cloned = self.deep_clone(arena);
        GenericBorder {
            width: cloned.width,
            style: cloned.style,
            color: cloned.color,
        }
    }

    pub fn eql(&self, other: &Self) -> bool {
        css::implement_eql(self, other)
    }

    #[inline]
    pub fn default() -> Self {
        Self {
            width: BorderSideWidth::Medium,
            style: S::default(),
            color: CssColor::CurrentColor,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// LineStyle
// ──────────────────────────────────────────────────────────────────────────

/// A [`<line-style>`](https://drafts.csswg.org/css-backgrounds/#typedef-line-style) value, used in the `border-style` property.
#[derive(Clone, Copy, PartialEq, Eq, Hash, css::DefineEnumProperty)] // TODO(port): provides eql/hash/parse/to_css/deep_clone
pub enum LineStyle {
    /// No border.
    None,
    /// Similar to `none` but with different rules for tables.
    Hidden,
    /// Looks as if the content on the inside of the border is sunken into the canvas.
    Inset,
    /// Looks as if it were carved in the canvas.
    Groove,
    /// Looks as if the content on the inside of the border is coming out of the canvas.
    Outset,
    /// Looks as if it were coming out of the canvas.
    Ridge,
    /// A series of round dots.
    Dotted,
    /// A series of square-ended dashes.
    Dashed,
    /// A single line segment.
    Solid,
    /// Two parallel solid lines with some space between them.
    Double,
}

impl LineStyle {
    pub fn is_compatible(&self, _: Browsers) -> bool {
        true
    }
}

impl Default for LineStyle {
    fn default() -> Self {
        LineStyle::None
    }
}

// ──────────────────────────────────────────────────────────────────────────
// BorderSideWidth
// ──────────────────────────────────────────────────────────────────────────

/// A value for the [border-width](https://www.w3.org/TR/css-backgrounds-3/#border-width) property.
#[derive(Clone, PartialEq, css::Parse, css::ToCss)]
pub enum BorderSideWidth {
    /// A UA defined `thin` value.
    Thin,
    /// A UA defined `medium` value.
    Medium,
    /// A UA defined `thick` value.
    Thick,
    /// An explicit width.
    Length(Length),
}

impl BorderSideWidth {
    // blocked_on: Length::is_compatible
    pub fn is_compatible(&self, browsers: Browsers) -> bool {
        match self {
            BorderSideWidth::Length(len) => len.is_compatible(browsers),
            _ => true,
        }
    }

    pub fn deep_clone(&self, _arena: &Bump) -> Self {
        // PORT NOTE: css.implementDeepClone — Length is value-type; Clone suffices.
        self.clone()
    }
}
crate::css_eql_partialeq!(BorderSideWidth);

impl Default for BorderSideWidth {
    fn default() -> Self {
        BorderSideWidth::Medium
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ImplFallbacks (Zig: `pub fn ImplFallbacks(comptime T: type) type`)
// ──────────────────────────────────────────────────────────────────────────
// TODO(port): Zig used `inline for (std.meta.fields(T))` reflection. We expand
// the field list at macro invocation. All fields are `CssColor`.
// Hoisted here because `macro_rules!` is order-sensitive.
macro_rules! impl_fallbacks {
    ($T:ty; $($field:ident),+) => {
        impl $T {
            pub fn get_fallbacks(
                &mut self,
                arena: &Bump,
                targets: Targets,
            ) -> SmallList<$T, 2> {
                let _ = arena;
                let mut fallbacks = ColorFallbackKind::empty();
                $(
                    fallbacks.insert(self.$field.get_necessary_fallbacks(targets));
                )+

                let mut res: SmallList<$T, 2> = SmallList::default();
                if fallbacks.contains(ColorFallbackKind::RGB) {
                    res.append(Self {
                        $(
                            $field: self.$field.get_fallback(arena, ColorFallbackKind::RGB),
                        )+
                    });
                }

                if fallbacks.contains(ColorFallbackKind::P3) {
                    res.append(Self {
                        $(
                            $field: self.$field.get_fallback(arena, ColorFallbackKind::P3),
                        )+
                    });
                }

                if fallbacks.contains(ColorFallbackKind::LAB) {
                    $(
                        self.$field = self.$field.get_fallback(arena, ColorFallbackKind::LAB);
                    )+
                }

                res
            }
        }
    };
}

// ──────────────────────────────────────────────────────────────────────────
// Rect shorthand structs (top/right/bottom/left)
// ──────────────────────────────────────────────────────────────────────────
// `define_rect_shorthand!` lives in `properties/mod.rs` (shared with
// `margin_padding.rs`).

// TODO: fallbacks
define_rect_shorthand! {
    /// A value for the [border-color](https://drafts.csswg.org/css-backgrounds/#propdef-border-color) shorthand property.
    BorderColor, CssColor,
    top: BorderTopColor,
    right: BorderRightColor,
    bottom: BorderBottomColor,
    left: BorderLeftColor
}
impl_fallbacks!(BorderColor; top, right, bottom, left);

define_rect_shorthand! {
    /// A value for the [border-style](https://drafts.csswg.org/css-backgrounds/#propdef-border-style) shorthand property.
    BorderStyle, LineStyle,
    top: BorderTopStyle,
    right: BorderRightStyle,
    bottom: BorderBottomStyle,
    left: BorderLeftStyle
}

define_rect_shorthand! {
    /// A value for the [border-width](https://drafts.csswg.org/css-backgrounds/#propdef-border-width) shorthand property.
    BorderWidth, BorderSideWidth,
    top: BorderTopWidth,
    right: BorderRightWidth,
    bottom: BorderBottomWidth,
    left: BorderLeftWidth
}

// ──────────────────────────────────────────────────────────────────────────
// Size shorthand structs (start/end)
// ──────────────────────────────────────────────────────────────────────────

macro_rules! define_size_shorthand {
    (
        $(#[$meta:meta])*
        $name:ident, $inner:ty,
        start: $start_id:ident,
        end: $end_id:ident
    ) => {
        $(#[$meta])*
        #[derive(Clone, PartialEq)]
        pub struct $name {
            /// The start value.
            pub start: $inner,
            /// The end value.
            pub end: $inner,
        }

        impl $name {
            // TODO(port): bring this back
            // (old using name space) css::DefineShorthand(@This(), PropertyIdTag::$shorthand_id);

            pub const PROPERTY_FIELD_MAP: &[(&str, PropertyIdTag)] = &[
                ("start", PropertyIdTag::$start_id),
                ("end", PropertyIdTag::$end_id),
            ];
        }
        // Zig `css.DefineSizeShorthand(@This(), V)` — parse/to_css via `Size2D<V>`.
        // Shared impl macro lives in `properties/mod.rs`.
        impl_size_shorthand!($name, $inner, start, end);
    };
}

// TODO: fallbacks
define_size_shorthand! {
    /// A value for the [border-block-color](https://drafts.csswg.org/css-logical/#propdef-border-block-color) shorthand property.
    BorderBlockColor, CssColor,
    start: BorderBlockStartColor,
    end: BorderBlockEndColor
}
impl_fallbacks!(BorderBlockColor; start, end);

define_size_shorthand! {
    /// A value for the [border-block-style](https://drafts.csswg.org/css-logical/#propdef-border-block-style) shorthand property.
    BorderBlockStyle, LineStyle,
    start: BorderBlockStartStyle,
    end: BorderBlockEndStyle
}

define_size_shorthand! {
    /// A value for the [border-block-width](https://drafts.csswg.org/css-logical/#propdef-border-block-width) shorthand property.
    BorderBlockWidth, BorderSideWidth,
    start: BorderBlockStartWidth,
    end: BorderBlockEndWidth
}

// TODO: fallbacks
define_size_shorthand! {
    /// A value for the [border-inline-color](https://drafts.csswg.org/css-logical/#propdef-border-inline-color) shorthand property.
    BorderInlineColor, CssColor,
    start: BorderInlineStartColor,
    end: BorderInlineEndColor
}
impl_fallbacks!(BorderInlineColor; start, end);

define_size_shorthand! {
    /// A value for the [border-inline-style](https://drafts.csswg.org/css-logical/#propdef-border-inline-style) shorthand property.
    BorderInlineStyle, LineStyle,
    start: BorderInlineStartStyle,
    end: BorderInlineEndStyle
}

define_size_shorthand! {
    /// A value for the [border-inline-width](https://drafts.csswg.org/css-logical/#propdef-border-inline-width) shorthand property.
    BorderInlineWidth, BorderSideWidth,
    start: BorderInlineStartWidth,
    end: BorderInlineEndWidth
}

// ──────────────────────────────────────────────────────────────────────────
// BorderShorthand (private)
// ──────────────────────────────────────────────────────────────────────────

#[derive(Default)]
struct BorderShorthand {
    width: Option<BorderSideWidth>,
    style: Option<LineStyle>,
    color: Option<CssColor>,
}

impl BorderShorthand {
    pub fn eql(&self, rhs: &Self) -> bool {
        css::generic::eql(&self.width, &rhs.width)
            && css::generic::eql(&self.style, &rhs.style)
            && css::generic::eql(&self.color, &rhs.color)
    }

    // `border: anytype` — any GenericBorder<S, P>
    pub fn set_border<S: for<'a> css::DeepClone<'a>, const P: u8>(
        &mut self,
        arena: &Bump,
        border: &GenericBorder<S, P>,
    ) where
        S: Into<LineStyle>,
    {
        // TODO(port): Zig accepted `anytype`; all callers pass GenericBorder<LineStyle, _>.
        self.width = Some(border.width.deep_clone(arena));
        self.style = Some(border.style.deep_clone(arena).into());
        self.color = Some(border.color.deep_clone(arena));
    }

    fn reset(&mut self, _arena: &Bump) {
        // PERF(port): was arena bulk-free via bun.clear — profile in Phase B
        self.width = None;
        self.style = None;
        self.color = None;
    }

    fn is_valid(&self) -> bool {
        self.width.is_some() && self.style.is_some() && self.color.is_some()
    }

    /// Generic over the `P` const param so the same `BorderShorthand` data
    /// can populate any of `BorderTop`/`BorderLeft`/.../`Border` (Zig used a
    /// single anonymous struct literal that coerced to each alias).
    fn to_border<const P: u8>(&self, arena: &Bump) -> GenericBorder<LineStyle, P> {
        GenericBorder {
            width: css::generic::deep_clone(&self.width, arena).unwrap(),
            style: css::generic::deep_clone(&self.style, arena).unwrap(),
            color: css::generic::deep_clone(&self.color, arena).unwrap(),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// BorderProperty bitflags (Zig: `packed struct(u32)` of all-bool fields)
// ──────────────────────────────────────────────────────────────────────────

bitflags::bitflags! {
    #[derive(Default, Clone, Copy)]
    struct BorderProperty: u32 {
        const TOP_COLOR          = 1 << 0;
        const BOTTOM_COLOR       = 1 << 1;
        const LEFT_COLOR         = 1 << 2;
        const RIGHT_COLOR        = 1 << 3;
        const BLOCK_START_COLOR  = 1 << 4;
        const BLOCK_END_COLOR    = 1 << 5;
        const INLINE_START_COLOR = 1 << 6;
        const INLINE_END_COLOR   = 1 << 7;
        const TOP_WIDTH          = 1 << 8;
        const BOTTOM_WIDTH       = 1 << 9;
        const LEFT_WIDTH         = 1 << 10;
        const RIGHT_WIDTH        = 1 << 11;
        const BLOCK_START_WIDTH  = 1 << 12;
        const BLOCK_END_WIDTH    = 1 << 13;
        const INLINE_START_WIDTH = 1 << 14;
        const INLINE_END_WIDTH   = 1 << 15;
        const TOP_STYLE          = 1 << 16;
        const BOTTOM_STYLE       = 1 << 17;
        const LEFT_STYLE         = 1 << 18;
        const RIGHT_STYLE        = 1 << 19;
        const BLOCK_START_STYLE  = 1 << 20;
        const BLOCK_END_STYLE    = 1 << 21;
        const INLINE_START_STYLE = 1 << 22;
        const INLINE_END_STYLE   = 1 << 23;
        // __unused: u8 = 0

        const BORDER_TOP_COLOR    = Self::TOP_COLOR.bits();
        const BORDER_BOTTOM_COLOR = Self::BOTTOM_COLOR.bits();
        const BORDER_LEFT_COLOR   = Self::LEFT_COLOR.bits();
        const BORDER_RIGHT_COLOR  = Self::RIGHT_COLOR.bits();
        const BORDER_BLOCK_START_COLOR  = Self::BLOCK_START_COLOR.bits();
        const BORDER_BLOCK_END_COLOR    = Self::BLOCK_END_COLOR.bits();
        const BORDER_INLINE_START_COLOR = Self::INLINE_START_COLOR.bits();
        const BORDER_INLINE_END_COLOR   = Self::INLINE_END_COLOR.bits();
        const BORDER_TOP_WIDTH    = Self::TOP_WIDTH.bits();
        const BORDER_BOTTOM_WIDTH = Self::BOTTOM_WIDTH.bits();
        const BORDER_LEFT_WIDTH   = Self::LEFT_WIDTH.bits();
        const BORDER_RIGHT_WIDTH  = Self::RIGHT_WIDTH.bits();
        const BORDER_BLOCK_START_WIDTH  = Self::BLOCK_START_WIDTH.bits();
        const BORDER_BLOCK_END_WIDTH    = Self::BLOCK_END_WIDTH.bits();
        const BORDER_INLINE_START_WIDTH = Self::INLINE_START_WIDTH.bits();
        const BORDER_INLINE_END_WIDTH   = Self::INLINE_END_WIDTH.bits();
        const BORDER_TOP_STYLE    = Self::TOP_STYLE.bits();
        const BORDER_BOTTOM_STYLE = Self::BOTTOM_STYLE.bits();
        const BORDER_LEFT_STYLE   = Self::LEFT_STYLE.bits();
        const BORDER_RIGHT_STYLE  = Self::RIGHT_STYLE.bits();
        const BORDER_BLOCK_START_STYLE  = Self::BLOCK_START_STYLE.bits();
        const BORDER_BLOCK_END_STYLE    = Self::BLOCK_END_STYLE.bits();
        const BORDER_INLINE_START_STYLE = Self::INLINE_START_STYLE.bits();
        const BORDER_INLINE_END_STYLE   = Self::INLINE_END_STYLE.bits();

        const BORDER_BLOCK_COLOR  = Self::BLOCK_START_COLOR.bits() | Self::BLOCK_END_COLOR.bits();
        const BORDER_INLINE_COLOR = Self::INLINE_START_COLOR.bits() | Self::INLINE_END_COLOR.bits();
        const BORDER_BLOCK_WIDTH  = Self::BLOCK_START_WIDTH.bits() | Self::BLOCK_END_WIDTH.bits();
        const BORDER_INLINE_WIDTH = Self::INLINE_START_WIDTH.bits() | Self::INLINE_END_WIDTH.bits();
        const BORDER_BLOCK_STYLE  = Self::BLOCK_START_STYLE.bits() | Self::BLOCK_END_STYLE.bits();
        const BORDER_INLINE_STYLE = Self::INLINE_START_STYLE.bits() | Self::INLINE_END_STYLE.bits();
        const BORDER_TOP    = Self::TOP_COLOR.bits()    | Self::TOP_WIDTH.bits()    | Self::TOP_STYLE.bits();
        const BORDER_BOTTOM = Self::BOTTOM_COLOR.bits() | Self::BOTTOM_WIDTH.bits() | Self::BOTTOM_STYLE.bits();
        const BORDER_LEFT   = Self::LEFT_COLOR.bits()   | Self::LEFT_WIDTH.bits()   | Self::LEFT_STYLE.bits();
        const BORDER_RIGHT  = Self::RIGHT_COLOR.bits()  | Self::RIGHT_WIDTH.bits()  | Self::RIGHT_STYLE.bits();
        const BORDER_BLOCK_START  = Self::BLOCK_START_COLOR.bits()  | Self::BLOCK_START_WIDTH.bits()  | Self::BLOCK_START_STYLE.bits();
        const BORDER_BLOCK_END    = Self::BLOCK_END_COLOR.bits()    | Self::BLOCK_END_WIDTH.bits()    | Self::BLOCK_END_STYLE.bits();
        const BORDER_INLINE_START = Self::INLINE_START_COLOR.bits() | Self::INLINE_START_WIDTH.bits() | Self::INLINE_START_STYLE.bits();
        const BORDER_INLINE_END   = Self::INLINE_END_COLOR.bits()   | Self::INLINE_END_WIDTH.bits()   | Self::INLINE_END_STYLE.bits();
        const BORDER_BLOCK  = Self::BORDER_BLOCK_COLOR.bits()  | Self::BORDER_BLOCK_WIDTH.bits()  | Self::BORDER_BLOCK_STYLE.bits();
        const BORDER_INLINE = Self::BORDER_INLINE_COLOR.bits() | Self::BORDER_INLINE_WIDTH.bits() | Self::BORDER_INLINE_STYLE.bits();
        const BORDER_WIDTH = Self::LEFT_WIDTH.bits() | Self::RIGHT_WIDTH.bits() | Self::TOP_WIDTH.bits() | Self::BOTTOM_WIDTH.bits();
        const BORDER_STYLE = Self::LEFT_STYLE.bits() | Self::RIGHT_STYLE.bits() | Self::TOP_STYLE.bits() | Self::BOTTOM_STYLE.bits();
        const BORDER_COLOR = Self::LEFT_COLOR.bits() | Self::RIGHT_COLOR.bits() | Self::TOP_COLOR.bits() | Self::BOTTOM_COLOR.bits();
        const BORDER = Self::BORDER_WIDTH.bits() | Self::BORDER_STYLE.bits() | Self::BORDER_COLOR.bits();
    }
}

// blocked_on: PropertyIdTag variant name verification (PascalCase mapping)
impl BorderProperty {
    pub fn try_from_property_id(property_id: PropertyIdTag) -> Option<Self> {
        // TODO(port): Zig used `inline for` over PropertyIdTag fields + @hasDecl.
        // Expanded to an explicit match over every PropertyIdTag whose name
        // starts with "border" and has a matching const above.
        use PropertyIdTag as P;
        Some(match property_id {
            P::BorderTopColor => Self::BORDER_TOP_COLOR,
            P::BorderBottomColor => Self::BORDER_BOTTOM_COLOR,
            P::BorderLeftColor => Self::BORDER_LEFT_COLOR,
            P::BorderRightColor => Self::BORDER_RIGHT_COLOR,
            P::BorderBlockStartColor => Self::BORDER_BLOCK_START_COLOR,
            P::BorderBlockEndColor => Self::BORDER_BLOCK_END_COLOR,
            P::BorderInlineStartColor => Self::BORDER_INLINE_START_COLOR,
            P::BorderInlineEndColor => Self::BORDER_INLINE_END_COLOR,
            P::BorderTopWidth => Self::BORDER_TOP_WIDTH,
            P::BorderBottomWidth => Self::BORDER_BOTTOM_WIDTH,
            P::BorderLeftWidth => Self::BORDER_LEFT_WIDTH,
            P::BorderRightWidth => Self::BORDER_RIGHT_WIDTH,
            P::BorderBlockStartWidth => Self::BORDER_BLOCK_START_WIDTH,
            P::BorderBlockEndWidth => Self::BORDER_BLOCK_END_WIDTH,
            P::BorderInlineStartWidth => Self::BORDER_INLINE_START_WIDTH,
            P::BorderInlineEndWidth => Self::BORDER_INLINE_END_WIDTH,
            P::BorderTopStyle => Self::BORDER_TOP_STYLE,
            P::BorderBottomStyle => Self::BORDER_BOTTOM_STYLE,
            P::BorderLeftStyle => Self::BORDER_LEFT_STYLE,
            P::BorderRightStyle => Self::BORDER_RIGHT_STYLE,
            P::BorderBlockStartStyle => Self::BORDER_BLOCK_START_STYLE,
            P::BorderBlockEndStyle => Self::BORDER_BLOCK_END_STYLE,
            P::BorderInlineStartStyle => Self::BORDER_INLINE_START_STYLE,
            P::BorderInlineEndStyle => Self::BORDER_INLINE_END_STYLE,
            P::BorderBlockColor => Self::BORDER_BLOCK_COLOR,
            P::BorderInlineColor => Self::BORDER_INLINE_COLOR,
            P::BorderBlockWidth => Self::BORDER_BLOCK_WIDTH,
            P::BorderInlineWidth => Self::BORDER_INLINE_WIDTH,
            P::BorderBlockStyle => Self::BORDER_BLOCK_STYLE,
            P::BorderInlineStyle => Self::BORDER_INLINE_STYLE,
            P::BorderTop => Self::BORDER_TOP,
            P::BorderBottom => Self::BORDER_BOTTOM,
            P::BorderLeft => Self::BORDER_LEFT,
            P::BorderRight => Self::BORDER_RIGHT,
            P::BorderBlockStart => Self::BORDER_BLOCK_START,
            P::BorderBlockEnd => Self::BORDER_BLOCK_END,
            P::BorderInlineStart => Self::BORDER_INLINE_START,
            P::BorderInlineEnd => Self::BORDER_INLINE_END,
            P::BorderBlock => Self::BORDER_BLOCK,
            P::BorderInline => Self::BORDER_INLINE,
            P::BorderWidth => Self::BORDER_WIDTH,
            P::BorderStyle => Self::BORDER_STYLE,
            P::BorderColor => Self::BORDER_COLOR,
            P::Border => Self::BORDER,
            _ => return None,
        })
    }
}

// ──────────────────────────────────────────────────────────────────────────
// BorderHandler
// ──────────────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct BorderHandler {
    border_top: BorderShorthand,
    border_bottom: BorderShorthand,
    border_left: BorderShorthand,
    border_right: BorderShorthand,
    border_block_start: BorderShorthand,
    border_block_end: BorderShorthand,
    border_inline_start: BorderShorthand,
    border_inline_end: BorderShorthand,
    category: PropertyCategory,
    border_image_handler: BorderImageHandler,
    border_radius_handler: BorderRadiusHandler,
    flushed_properties: BorderProperty,
    has_any: bool,
}

// Real `handle_property`/`finalize` bodies live in `border_handler_body` below.
mod border_handler_body {
    use super::*;
    use crate::generics::{CssEql, DeepClone};
    // ──────────────────────────────────────────────────────────────────────────
    // FlushContext + flush_category! (Zig: nested struct with inline fns and
    // extensive comptime string-dispatch)
    // ──────────────────────────────────────────────────────────────────────────
    // PORT NOTE: hoisted above `impl BorderHandler` — macro_rules! is order-
    // sensitive and the flush_category!() callsites in `flush()` need these.

    struct FlushContext<'a, 'bump, 'ctx> {
        // PORT NOTE: Zig stored `self: *BorderHandler`; we only need flushed_properties
        // here because the per-side BorderShorthand pointers are passed separately.
        flushed_properties: &'a mut BorderProperty,
        dest: &'a mut DeclarationList<'bump>,
        ctx: &'a mut PropertyHandlerContext<'ctx>,
        // PORT NOTE: `arena` field dropped from PropertyHandlerContext; the
        // arena is recovered once via `dest.bump()` and threaded here.
        arena: &'bump Bump,
        logical_supported: bool,
        logical_shorthand_supported: bool,
    }

    // `f.logicalProp(ltr, ltr_key, rtl, rtl_key, val)` — ltr_key/rtl_key were unused.
    // PORT NOTE: `$val` is evaluated *before* reborrowing `$f` so callers may pass
    // expressions that read `f.arena` without tripping E0502.
    macro_rules! fc_logical_prop {
        // PORT NOTE: the `GenericBorder` shorthand pairs carry distinct const-generic
        // discriminants per side (BorderLeft = P=3, BorderRight = P=1), so a single
        // `__val` cannot `deep_clone()` into both `Property` variants. Recast via
        // `clone_as::<Q>()` instead. Callers always pass a `to_border()` result here,
        // so the `__val` annotation drives `P` inference for that call.
        ($f:expr, BorderLeft, BorderRight, $val:expr) => {{
            let __val: BorderLeft = $val;
            let f = &mut *$f;
            f.ctx.add_logical_rule(
                Property::BorderLeft(__val.clone_as(f.arena)),
                Property::BorderRight(__val.clone_as(f.arena)),
            );
        }};
        ($f:expr, BorderRight, BorderLeft, $val:expr) => {{
            let __val: BorderRight = $val;
            let f = &mut *$f;
            f.ctx.add_logical_rule(
                Property::BorderRight(__val.clone_as(f.arena)),
                Property::BorderLeft(__val.clone_as(f.arena)),
            );
        }};
        ($f:expr, $ltr:ident, $rtl:ident, $val:expr) => {{
            let __val = $val;
            let f = &mut *$f;
            f.ctx.add_logical_rule(
                Property::$ltr(__val.deep_clone(f.arena)),
                Property::$rtl(__val.deep_clone(f.arena)),
            );
        }};
    }

    // `f.push(p, val)`
    // PORT NOTE: Zig's `@field(BorderProperty, p)` keyed both Property and BorderProperty
    // off one kebab string. Here `$p` is the PascalCase Property/PropertyIdTag variant;
    // the bitflags const is derived via try_from_property_id so a single ident suffices.
    macro_rules! fc_push {
        ($f:expr, $p:ident, $val:expr) => {{
            let __val = $val;
            let f = &mut *$f;
            f.flushed_properties
                .insert(BorderProperty::try_from_property_id(PropertyIdTag::$p).unwrap());
            f.dest.push(Property::$p(__val.deep_clone(f.arena)));
        }};
    }

    // `f.fallbacks(p, _val)`
    macro_rules! fc_fallbacks {
        ($f:expr, $p:ident, $val:expr) => {{
            let mut val = $val;
            let f = &mut *$f;
            if !f
                .flushed_properties
                .contains(BorderProperty::try_from_property_id(PropertyIdTag::$p).unwrap())
            {
                let fbs = val.get_fallbacks(f.arena, f.ctx.targets);
                for fallback in css::generic::slice(&fbs) {
                    f.dest.push(Property::$p(fallback.clone()));
                }
            }
            fc_push!(f, $p, val);
        }};
    }

    // `f.prop(prop_name, val)` — comptime string dispatch over prop_name.
    // In Rust we dispatch on the Property variant ident.
    macro_rules! fc_prop {
        // border-inline-start*
        ($f:expr, BorderInlineStart, $val:expr) => {{
            if $f.logical_supported {
                fc_fallbacks!($f, BorderInlineStart, $val);
            } else {
                fc_logical_prop!($f, BorderLeft, BorderRight, $val);
            }
        }};
        ($f:expr, BorderInlineStartWidth, $val:expr) => {{
            if $f.logical_supported {
                fc_push!($f, BorderInlineStartWidth, $val);
            } else {
                fc_logical_prop!($f, BorderLeftWidth, BorderRightWidth, $val);
            }
        }};
        ($f:expr, BorderInlineStartColor, $val:expr) => {{
            if $f.logical_supported {
                fc_fallbacks!($f, BorderInlineStartColor, $val);
            } else {
                fc_logical_prop!($f, BorderLeftColor, BorderRightColor, $val);
            }
        }};
        ($f:expr, BorderInlineStartStyle, $val:expr) => {{
            if $f.logical_supported {
                fc_push!($f, BorderInlineStartStyle, $val);
            } else {
                fc_logical_prop!($f, BorderLeftStyle, BorderRightStyle, $val);
            }
        }};
        // border-inline-end*
        ($f:expr, BorderInlineEnd, $val:expr) => {{
            if $f.logical_supported {
                fc_fallbacks!($f, BorderInlineEnd, $val);
            } else {
                fc_logical_prop!($f, BorderRight, BorderLeft, $val);
            }
        }};
        ($f:expr, BorderInlineEndWidth, $val:expr) => {{
            if $f.logical_supported {
                fc_push!($f, BorderInlineEndWidth, $val);
            } else {
                fc_logical_prop!($f, BorderRightWidth, BorderLeftWidth, $val);
            }
        }};
        ($f:expr, BorderInlineEndColor, $val:expr) => {{
            if $f.logical_supported {
                fc_fallbacks!($f, BorderInlineEndColor, $val);
            } else {
                fc_logical_prop!($f, BorderRightColor, BorderLeftColor, $val);
            }
        }};
        ($f:expr, BorderInlineEndStyle, $val:expr) => {{
            if $f.logical_supported {
                fc_push!($f, BorderInlineEndStyle, $val);
            } else {
                fc_logical_prop!($f, BorderRightStyle, BorderLeftStyle, $val);
            }
        }};
        // border-block-start*
        ($f:expr, BorderBlockStart, $val:expr) => {{
            if $f.logical_supported {
                fc_fallbacks!($f, BorderBlockStart, $val);
            } else {
                fc_fallbacks!($f, BorderTop, $val);
            }
        }};
        ($f:expr, BorderBlockStartWidth, $val:expr) => {{
            if $f.logical_supported {
                fc_push!($f, BorderBlockStartWidth, $val);
            } else {
                fc_push!($f, BorderTopWidth, $val);
            }
        }};
        ($f:expr, BorderBlockStartColor, $val:expr) => {{
            if $f.logical_supported {
                fc_fallbacks!($f, BorderBlockStartColor, $val);
            } else {
                fc_fallbacks!($f, BorderTopColor, $val);
            }
        }};
        ($f:expr, BorderBlockStartStyle, $val:expr) => {{
            if $f.logical_supported {
                fc_push!($f, BorderBlockStartStyle, $val);
            } else {
                fc_push!($f, BorderTopStyle, $val);
            }
        }};
        // border-block-end*
        ($f:expr, BorderBlockEnd, $val:expr) => {{
            if $f.logical_supported {
                fc_fallbacks!($f, BorderBlockEnd, $val);
            } else {
                fc_fallbacks!($f, BorderBottom, $val);
            }
        }};
        ($f:expr, BorderBlockEndWidth, $val:expr) => {{
            if $f.logical_supported {
                fc_push!($f, BorderBlockEndWidth, $val);
            } else {
                fc_push!($f, BorderBottomWidth, $val);
            }
        }};
        ($f:expr, BorderBlockEndColor, $val:expr) => {{
            if $f.logical_supported {
                fc_fallbacks!($f, BorderBlockEndColor, $val);
            } else {
                fc_fallbacks!($f, BorderBottomColor, $val);
            }
        }};
        ($f:expr, BorderBlockEndStyle, $val:expr) => {{
            if $f.logical_supported {
                fc_push!($f, BorderBlockEndStyle, $val);
            } else {
                fc_push!($f, BorderBottomStyle, $val);
            }
        }};
        // Color/shorthand props that always use fallbacks
        ($f:expr, BorderLeftColor, $val:expr) => {
            fc_fallbacks!($f, BorderLeftColor, $val)
        };
        ($f:expr, BorderRightColor, $val:expr) => {
            fc_fallbacks!($f, BorderRightColor, $val)
        };
        ($f:expr, BorderTopColor, $val:expr) => {
            fc_fallbacks!($f, BorderTopColor, $val)
        };
        ($f:expr, BorderBottomColor, $val:expr) => {
            fc_fallbacks!($f, BorderBottomColor, $val)
        };
        ($f:expr, BorderColor, $val:expr) => {
            fc_fallbacks!($f, BorderColor, $val)
        };
        ($f:expr, BorderBlockColor, $val:expr) => {
            fc_fallbacks!($f, BorderBlockColor, $val)
        };
        ($f:expr, BorderInlineColor, $val:expr) => {
            fc_fallbacks!($f, BorderInlineColor, $val)
        };
        ($f:expr, BorderLeft, $val:expr) => {
            fc_fallbacks!($f, BorderLeft, $val)
        };
        ($f:expr, BorderRight, $val:expr) => {
            fc_fallbacks!($f, BorderRight, $val)
        };
        ($f:expr, BorderTop, $val:expr) => {
            fc_fallbacks!($f, BorderTop, $val)
        };
        ($f:expr, BorderBottom, $val:expr) => {
            fc_fallbacks!($f, BorderBottom, $val)
        };
        ($f:expr, BorderInline, $val:expr) => {
            fc_fallbacks!($f, BorderInline, $val)
        };
        ($f:expr, BorderBlock, $val:expr) => {
            fc_fallbacks!($f, BorderBlock, $val)
        };
        ($f:expr, Border, $val:expr) => {
            fc_fallbacks!($f, Border, $val)
        };
        // Everything else: plain push
        ($f:expr, $p:ident, $val:expr) => {
            fc_push!($f, $p, $val)
        };
    }

    // `flushCategory(...)` — was a fn with comptime string params + nested `State`
    // struct of inline fns. In Rust we expand it as a macro so the `comptime` prop
    // names remain compile-time idents and the nested closures become local macros.
    macro_rules! flush_category {
    (
        $f:expr,
        $block_start_prop:ident, $block_start_width:ident, $block_start_style:ident, $block_start_color:ident, $block_start:expr,
        $block_end_prop:ident, $block_end_width:ident, $block_end_style:ident, $block_end_color:ident, $block_end:expr,
        $inline_start_prop:ident, $inline_start_width:ident, $inline_start_style:ident, $inline_start_color:ident, $inline_start:expr,
        $inline_end_prop:ident, $inline_end_width:ident, $inline_end_style:ident, $inline_end_color:ident, $inline_end:expr,
        is_logical = $is_logical:literal
    ) => {{
        let f: &mut FlushContext = $f;
        let block_start: &mut BorderShorthand = $block_start;
        let block_end: &mut BorderShorthand = $block_end;
        let inline_start: &mut BorderShorthand = $inline_start;
        let inline_end: &mut BorderShorthand = $inline_end;

        // State.shorthand
        macro_rules! shorthand {
            ($P:ident, $prop_name:ident, $key:ident) => {{
                let has_prop = block_start.$key.is_some()
                    && block_end.$key.is_some()
                    && inline_start.$key.is_some()
                    && inline_end.$key.is_some();
                if has_prop {
                    if !$is_logical
                        || (css::generic::eql(&block_start.$key, &block_end.$key)
                            && css::generic::eql(&block_end.$key, &inline_start.$key)
                            && css::generic::eql(&inline_start.$key, &inline_end.$key))
                    {
                        let rect = $P {
                            top: block_start.$key.take().unwrap(),
                            right: inline_end.$key.take().unwrap(),
                            bottom: block_end.$key.take().unwrap(),
                            left: inline_start.$key.take().unwrap(),
                        };
                        fc_prop!(f, $prop_name, rect);
                    }
                }
            }};
        }

        // State.logicalShorthand
        macro_rules! logical_shorthand {
            ($P:ident, $prop_name:ident, $key:ident, $start:expr, $end:expr) => {{
                let has_prop = $start.$key.is_some() && $end.$key.is_some();
                if has_prop {
                    fc_prop!(
                        f,
                        $prop_name,
                        $P {
                            start: $start.$key.take().unwrap(),
                            end: $end.$key.take().unwrap(),
                        }
                    );
                    $end.$key = None;
                }
            }};
        }

        // State.is_eq
        macro_rules! is_eq {
            ($key:ident) => {
                css::generic::eql(&block_start.$key, &block_end.$key)
                    && css::generic::eql(&inline_start.$key, &inline_end.$key)
                    && css::generic::eql(&inline_start.$key, &block_start.$key)
            };
        }

        // State.side_diff
        macro_rules! side_diff {
            ($border:expr, $other:expr, $prop_name:ident, $width:ident, $style:ident, $color:ident) => {{
                let eq_width = css::generic::eql(&$border.width, &$other.width);
                let eq_style = css::generic::eql(&$border.style, &$other.style);
                let eq_color = css::generic::eql(&$border.color, &$other.color);

                // If only one of the sub-properties is different, only emit that.
                // Otherwise, emit the full border value.
                if eq_width && eq_style {
                    fc_prop!(f, $color, css::generic::deep_clone(&$other.color, f.arena).unwrap());
                } else if eq_width && eq_color {
                    fc_prop!(f, $style, css::generic::deep_clone(&$other.style, f.arena).unwrap());
                } else if eq_style && eq_color {
                    fc_prop!(f, $width, css::generic::deep_clone(&$other.width, f.arena).unwrap());
                } else {
                    fc_prop!(f, $prop_name, $other.to_border(f.arena));
                }
            }};
        }

        // State.prop_diff
        macro_rules! prop_diff {
            ($border:expr, $fallback:block, $border_fallback:literal) => {{
                if !$is_logical && is_eq!(color) && is_eq!(style) {
                    fc_prop!(f, Border, $border.to_border(f.arena));
                    shorthand!(BorderWidth, BorderWidth, width);
                } else if !$is_logical && is_eq!(width) && is_eq!(style) {
                    fc_prop!(f, Border, $border.to_border(f.arena));
                    shorthand!(BorderColor, BorderColor, color);
                } else if !$is_logical && is_eq!(width) && is_eq!(color) {
                    fc_prop!(f, Border, $border.to_border(f.arena));
                    shorthand!(BorderStyle, BorderStyle, style);
                } else {
                    if $border_fallback {
                        fc_prop!(f, Border, $border.to_border(f.arena));
                    }
                    $fallback
                }
            }};
        }

        // State.side
        macro_rules! side {
            ($val:expr, $short:ident, $width:ident, $style:ident, $color:ident) => {{
                if $val.is_valid() {
                    fc_prop!(f, $short, $val.to_border(f.arena));
                } else {
                    if let Some(sty) = &$val.style {
                        fc_prop!(f, $style, sty.deep_clone(f.arena));
                    }

                    if let Some(w) = &$val.width {
                        fc_prop!(f, $width, w.deep_clone(f.arena));
                    }

                    if let Some(c) = &$val.color {
                        fc_prop!(f, $color, c.deep_clone(f.arena));
                    }
                }
            }};
        }

        // State.inlineProp
        // If both values of an inline logical property are equal, then we can just convert them to physical properties.
        macro_rules! inline_prop {
            ($key:ident, $left:ident, $right:ident) => {{
                if inline_start.$key.is_some()
                    && css::generic::eql(&inline_start.$key, &inline_end.$key)
                {
                    fc_prop!(f, $left, inline_start.$key.take().unwrap());
                    fc_prop!(f, $right, inline_end.$key.take().unwrap());
                }
            }};
        }

        if block_start.is_valid()
            && block_end.is_valid()
            && inline_start.is_valid()
            && inline_end.is_valid()
        {
            let top_eq_bottom = block_start.eql(block_end);
            let left_eq_right = inline_start.eql(inline_end);
            let top_eq_left = block_start.eql(inline_start);
            let top_eq_right = block_start.eql(inline_end);
            let bottom_eq_left = block_end.eql(inline_start);
            let bottom_eq_right = block_end.eql(inline_end);

            if top_eq_bottom && top_eq_left && top_eq_right {
                fc_prop!(f, Border, block_start.to_border(f.arena));
            } else if top_eq_bottom && top_eq_left {
                fc_prop!(f, Border, block_start.to_border(f.arena));
                side_diff!(block_start, inline_end, $inline_end_prop, $inline_end_width, $inline_end_style, $inline_end_color);
            } else if top_eq_bottom && top_eq_right {
                fc_prop!(f, Border, block_start.to_border(f.arena));
                side_diff!(block_start, inline_start, $inline_start_prop, $inline_start_width, $inline_start_style, $inline_start_color);
            } else if left_eq_right && bottom_eq_left {
                fc_prop!(f, Border, inline_start.to_border(f.arena));
                side_diff!(inline_start, block_start, $block_start_prop, $block_start_width, $block_start_style, $block_start_color);
            } else if left_eq_right && top_eq_left {
                fc_prop!(f, Border, inline_start.to_border(f.arena));
                side_diff!(inline_start, block_end, $block_end_prop, $block_end_width, $block_end_style, $block_end_color);
            } else if top_eq_bottom {
                prop_diff!(block_start, {
                    // Try to use border-inline shorthands for the opposite direction if possible
                    let mut handled = false;
                    if $is_logical {
                        let mut diff: u32 = 0;
                        if !css::generic::eql(&inline_start.width, &block_start.width)
                            || !css::generic::eql(&inline_end.width, &block_start.width)
                        {
                            diff += 1;
                        }
                        if !css::generic::eql(&inline_start.style, &block_start.style)
                            || !css::generic::eql(&inline_end.style, &block_start.style)
                        {
                            diff += 1;
                        }
                        if !css::generic::eql(&inline_start.color, &block_start.color)
                            || !css::generic::eql(&inline_end.color, &block_start.color)
                        {
                            diff += 1;
                        }

                        if diff == 1 {
                            if !css::generic::eql(&inline_start.width, &block_start.width) {
                                fc_prop!(f, BorderInlineWidth, BorderInlineWidth {
                                    start: inline_start.width.as_ref().unwrap().deep_clone(f.arena),
                                    end: inline_end.width.as_ref().unwrap().deep_clone(f.arena),
                                });
                                handled = true;
                            } else if !css::generic::eql(&inline_start.style, &block_start.style) {
                                fc_prop!(f, BorderInlineStyle, BorderInlineStyle {
                                    start: inline_start.style.as_ref().unwrap().deep_clone(f.arena),
                                    end: inline_end.style.as_ref().unwrap().deep_clone(f.arena),
                                });
                                handled = true;
                            } else if !css::generic::eql(&inline_start.color, &block_start.color) {
                                fc_prop!(f, BorderInlineColor, BorderInlineColor {
                                    start: inline_start.color.as_ref().unwrap().deep_clone(f.arena),
                                    end: inline_end.color.as_ref().unwrap().deep_clone(f.arena),
                                });
                                handled = true;
                            }
                        } else if diff > 1
                            && css::generic::eql(&inline_start.width, &inline_end.width)
                            && css::generic::eql(&inline_start.style, &inline_end.style)
                            && css::generic::eql(&inline_start.color, &inline_end.color)
                        {
                            fc_prop!(f, BorderInline, inline_start.to_border(f.arena));
                            handled = true;
                        }
                    }

                    if !handled {
                        side_diff!(block_start, inline_start, $inline_start_prop, $inline_start_width, $inline_start_style, $inline_start_color);
                        side_diff!(block_start, inline_end, $inline_end_prop, $inline_end_width, $inline_end_style, $inline_end_color);
                    }
                }, true);
            } else if left_eq_right {
                prop_diff!(inline_start, {
                    // We know already that top != bottom, so no need to try to use border-block.
                    side_diff!(inline_start, block_start, $block_start_prop, $block_start_width, $block_start_style, $block_start_color);
                    side_diff!(inline_start, block_end, $block_end_prop, $block_end_width, $block_end_style, $block_end_color);
                }, true);
            } else if bottom_eq_right {
                prop_diff!(block_end, {
                    side_diff!(block_end, block_start, $block_start_prop, $block_start_width, $block_start_style, $block_start_color);
                    side_diff!(block_end, inline_start, $inline_start_prop, $inline_start_width, $inline_start_style, $inline_start_color);
                }, true);
            } else {
                prop_diff!(block_start, {
                    fc_prop!(f, $block_start_prop, block_start.to_border(f.arena));
                    fc_prop!(f, $block_end_prop, block_end.to_border(f.arena));
                    fc_prop!(f, $inline_start_prop, inline_start.to_border(f.arena));
                    fc_prop!(f, $inline_end_prop, inline_end.to_border(f.arena));
                }, false);
            }
        } else {
            shorthand!(BorderStyle, BorderStyle, style);
            shorthand!(BorderWidth, BorderWidth, width);
            shorthand!(BorderColor, BorderColor, color);

            if $is_logical && block_start.eql(block_end) && block_start.is_valid() {
                if f.logical_supported {
                    if f.logical_shorthand_supported {
                        fc_prop!(f, BorderBlock, block_start.to_border(f.arena));
                    } else {
                        fc_prop!(f, BorderBlockStart, block_start.to_border(f.arena));
                        fc_prop!(f, BorderBlockEnd, block_start.to_border(f.arena));
                    }
                } else {
                    fc_prop!(f, BorderTop, block_start.to_border(f.arena));
                    fc_prop!(f, BorderBottom, block_start.to_border(f.arena));
                }
            } else {
                if $is_logical
                    && f.logical_shorthand_supported
                    && !block_start.is_valid()
                    && !block_end.is_valid()
                {
                    logical_shorthand!(BorderBlockStyle, BorderBlockStyle, style, block_start, block_end);
                    logical_shorthand!(BorderBlockWidth, BorderBlockWidth, width, block_start, block_end);
                    logical_shorthand!(BorderBlockColor, BorderBlockColor, color, block_start, block_end);
                }

                side!(block_start, $block_start_prop, $block_start_width, $block_start_style, $block_start_color);
                side!(block_end, $block_end_prop, $block_end_width, $block_end_style, $block_end_color);
            }

            if $is_logical && inline_start.eql(inline_end) && inline_start.is_valid() {
                if f.logical_supported {
                    if f.logical_shorthand_supported {
                        fc_prop!(f, BorderInline, inline_start.to_border(f.arena));
                    } else {
                        fc_prop!(f, BorderInlineStart, inline_start.to_border(f.arena));
                        fc_prop!(f, BorderInlineEnd, inline_start.to_border(f.arena));
                    }
                } else {
                    fc_prop!(f, BorderLeft, inline_start.to_border(f.arena));
                    fc_prop!(f, BorderRight, inline_start.to_border(f.arena));
                }
            } else {
                if $is_logical && !inline_start.is_valid() && !inline_end.is_valid() {
                    if f.logical_shorthand_supported {
                        logical_shorthand!(BorderInlineStyle, BorderInlineStyle, style, inline_start, inline_end);
                        logical_shorthand!(BorderInlineWidth, BorderInlineWidth, width, inline_start, inline_end);
                        logical_shorthand!(BorderInlineColor, BorderInlineColor, color, inline_start, inline_end);
                    } else {
                        // If both values of an inline logical property are equal, then we can just convert them to physical properties.
                        inline_prop!(style, BorderLeftStyle, BorderRightStyle);
                        inline_prop!(width, BorderLeftWidth, BorderRightWidth);
                        inline_prop!(color, BorderLeftColor, BorderRightColor);
                    }
                }

                side!(inline_start, $inline_start_prop, $inline_start_width, $inline_start_style, $inline_start_color);
                side!(inline_end, $inline_end_prop, $inline_end_width, $inline_end_style, $inline_end_color);
            }
        }
    }};
}
    use flush_category;

    impl BorderHandler {
        pub fn handle_property(
            &mut self,
            property: &Property,
            dest: &mut DeclarationList,
            context: &mut PropertyHandlerContext,
        ) -> bool {
            // PORT NOTE: `arena` field dropped from PropertyHandlerContext; the
            // arena is recovered via `dest.bump()` (DeclarationList = bumpalo::Vec).
            let arena = dest.bump();

            // Helper macros — Zig used local comptime closures with @field string access.

            macro_rules! flush_helper {
                ($key:ident, $prop:ident, $val:expr, $category:expr) => {{
                    if $category != self.category {
                        self.flush(dest, context);
                    }

                    if let Some(existing) = &self.$key.$prop {
                        if !existing.eql($val)
                            && context.targets.browsers.is_some()
                            && !css::generic::is_compatible($val, context.targets.browsers.unwrap())
                        {
                            self.flush(dest, context);
                        }
                    }
                }};
            }

            macro_rules! property_helper {
                ($key:ident, $prop:ident, $val:expr, $category:expr) => {{
                    flush_helper!($key, $prop, $val, $category);
                    self.$key.$prop = Some($val.deep_clone(arena));
                    self.category = $category;
                    self.has_any = true;
                }};
            }

            macro_rules! set_border_helper {
                ($key:ident, $val:expr, $category:expr) => {{
                    if $category != self.category {
                        self.flush(dest, context);
                    }

                    self.$key.set_border(arena, $val);
                    self.category = $category;
                    self.has_any = true;
                }};
            }

            use PropertyCategory::{Logical, Physical};

            match property {
                Property::BorderTopColor(val) => property_helper!(border_top, color, val, Physical),
                Property::BorderBottomColor(val) => {
                    property_helper!(border_bottom, color, val, Physical)
                }
                Property::BorderLeftColor(val) => {
                    property_helper!(border_left, color, val, Physical)
                }
                Property::BorderRightColor(val) => {
                    property_helper!(border_right, color, val, Physical)
                }
                Property::BorderBlockStartColor(val) => {
                    property_helper!(border_block_start, color, val, Logical)
                }
                Property::BorderBlockEndColor(val) => {
                    property_helper!(border_block_end, color, val, Logical)
                }
                Property::BorderBlockColor(val) => {
                    property_helper!(border_block_start, color, &val.start, Logical);
                    property_helper!(border_block_end, color, &val.end, Logical);
                }
                Property::BorderInlineStartColor(val) => {
                    property_helper!(border_inline_start, color, val, Logical)
                }
                Property::BorderInlineEndColor(val) => {
                    property_helper!(border_inline_end, color, val, Logical)
                }
                Property::BorderInlineColor(val) => {
                    property_helper!(border_inline_start, color, &val.start, Logical);
                    property_helper!(border_inline_end, color, &val.end, Logical);
                }
                Property::BorderTopWidth(val) => property_helper!(border_top, width, val, Physical),
                Property::BorderBottomWidth(val) => {
                    property_helper!(border_bottom, width, val, Physical)
                }
                Property::BorderLeftWidth(val) => {
                    property_helper!(border_left, width, val, Physical)
                }
                Property::BorderRightWidth(val) => {
                    property_helper!(border_right, width, val, Physical)
                }
                Property::BorderBlockStartWidth(val) => {
                    property_helper!(border_block_start, width, val, Logical)
                }
                Property::BorderBlockEndWidth(val) => {
                    property_helper!(border_block_end, width, val, Logical)
                }
                Property::BorderBlockWidth(val) => {
                    property_helper!(border_block_start, width, &val.start, Logical);
                    property_helper!(border_block_end, width, &val.end, Logical);
                }
                Property::BorderInlineStartWidth(val) => {
                    property_helper!(border_inline_start, width, val, Logical)
                }
                Property::BorderInlineEndWidth(val) => {
                    property_helper!(border_inline_end, width, val, Logical)
                }
                Property::BorderInlineWidth(val) => {
                    property_helper!(border_inline_start, width, &val.start, Logical);
                    property_helper!(border_inline_end, width, &val.end, Logical);
                }
                Property::BorderTopStyle(val) => property_helper!(border_top, style, val, Physical),
                Property::BorderBottomStyle(val) => {
                    property_helper!(border_bottom, style, val, Physical)
                }
                Property::BorderLeftStyle(val) => {
                    property_helper!(border_left, style, val, Physical)
                }
                Property::BorderRightStyle(val) => {
                    property_helper!(border_right, style, val, Physical)
                }
                Property::BorderBlockStartStyle(val) => {
                    property_helper!(border_block_start, style, val, Logical)
                }
                Property::BorderBlockEndStyle(val) => {
                    property_helper!(border_block_end, style, val, Logical)
                }
                Property::BorderBlockStyle(val) => {
                    property_helper!(border_block_start, style, &val.start, Logical);
                    property_helper!(border_block_end, style, &val.end, Logical);
                }
                Property::BorderInlineStartStyle(val) => {
                    property_helper!(border_inline_start, style, val, Logical)
                }
                Property::BorderInlineEndStyle(val) => {
                    property_helper!(border_inline_end, style, val, Logical)
                }
                Property::BorderInlineStyle(val) => {
                    property_helper!(border_inline_start, style, &val.start, Logical);
                    property_helper!(border_inline_end, style, &val.end, Logical);
                }
                Property::BorderTop(val) => set_border_helper!(border_top, val, Physical),
                Property::BorderBottom(val) => set_border_helper!(border_bottom, val, Physical),
                Property::BorderLeft(val) => set_border_helper!(border_left, val, Physical),
                Property::BorderRight(val) => set_border_helper!(border_right, val, Physical),
                Property::BorderBlockStart(val) => {
                    set_border_helper!(border_block_start, val, Logical)
                }
                Property::BorderBlockEnd(val) => set_border_helper!(border_block_end, val, Logical),
                Property::BorderInlineStart(val) => {
                    set_border_helper!(border_inline_start, val, Logical)
                }
                Property::BorderInlineEnd(val) => {
                    set_border_helper!(border_inline_end, val, Logical)
                }
                Property::BorderBlock(val) => {
                    set_border_helper!(border_block_start, val, Logical);
                    set_border_helper!(border_block_end, val, Logical);
                }
                Property::BorderInline(val) => {
                    set_border_helper!(border_inline_start, val, Logical);
                    set_border_helper!(border_inline_end, val, Logical);
                }
                Property::BorderWidth(val) => {
                    property_helper!(border_top, width, &val.top, Physical);
                    property_helper!(border_right, width, &val.right, Physical);
                    property_helper!(border_bottom, width, &val.bottom, Physical);
                    property_helper!(border_left, width, &val.left, Physical);

                    self.border_block_start.width = None;
                    self.border_block_end.width = None;
                    self.border_inline_start.width = None;
                    self.border_inline_end.width = None;
                    self.has_any = true;
                }
                Property::BorderStyle(val) => {
                    property_helper!(border_top, style, &val.top, Physical);
                    property_helper!(border_right, style, &val.right, Physical);
                    property_helper!(border_bottom, style, &val.bottom, Physical);
                    property_helper!(border_left, style, &val.left, Physical);

                    self.border_block_start.style = None;
                    self.border_block_end.style = None;
                    self.border_inline_start.style = None;
                    self.border_inline_end.style = None;
                    self.has_any = true;
                }
                Property::BorderColor(val) => {
                    property_helper!(border_top, color, &val.top, Physical);
                    property_helper!(border_right, color, &val.right, Physical);
                    property_helper!(border_bottom, color, &val.bottom, Physical);
                    property_helper!(border_left, color, &val.left, Physical);

                    self.border_block_start.color = None;
                    self.border_block_end.color = None;
                    self.border_inline_start.color = None;
                    self.border_inline_end.color = None;
                    self.has_any = true;
                }
                Property::Border(val) => {
                    self.border_top.set_border(arena, val);
                    self.border_bottom.set_border(arena, val);
                    self.border_left.set_border(arena, val);
                    self.border_right.set_border(arena, val);

                    self.border_block_start.reset(arena);
                    self.border_block_end.reset(arena);
                    self.border_inline_start.reset(arena);
                    self.border_inline_end.reset(arena);

                    // Setting the `border` property resets `border-image`
                    self.border_image_handler.reset();
                    self.has_any = true;
                }
                Property::Unparsed(val) => {
                    if is_border_property(val.property_id.tag()) {
                        self.flush(dest, context);
                        self.flush_unparsed(val, dest, context);
                    } else {
                        if self.border_image_handler.will_flush(property) {
                            self.flush(dest, context);
                        }
                        return self
                            .border_image_handler
                            .handle_property(property, dest, context)
                            || self
                                .border_radius_handler
                                .handle_property(property, dest, context);
                    }
                }
                _ => {
                    if self.border_image_handler.will_flush(property) {
                        self.flush(dest, context);
                    }
                    return self
                        .border_image_handler
                        .handle_property(property, dest, context)
                        || self
                            .border_radius_handler
                            .handle_property(property, dest, context);
                }
            }

            true
        }

        pub fn finalize(
            &mut self,
            dest: &mut DeclarationList,
            context: &mut PropertyHandlerContext,
        ) {
            self.flush(dest, context);
            self.flushed_properties = BorderProperty::empty();
            self.border_image_handler.finalize(dest, context);
            self.border_radius_handler.finalize(dest, context);
        }

        fn flush(&mut self, dest: &mut DeclarationList, context: &mut PropertyHandlerContext) {
            if !self.has_any {
                return;
            }

            self.has_any = false;

            let logical_supported = !context.should_compile_logical(Feature::LogicalBorders);
            let logical_shorthand_supported =
                !context.should_compile_logical(Feature::LogicalBorderShorthand);

            // PORT NOTE: reshaped for borrowck — Zig stored `self: *BorderHandler` in
            // FlushContext and accessed self.border_* through it. We instead take
            // independent &mut borrows of each shorthand, plus &mut self.flushed_properties.
            let arena = dest.bump();
            let mut flctx = FlushContext {
                flushed_properties: &mut self.flushed_properties,
                dest,
                ctx: context,
                arena,
                logical_supported,
                logical_shorthand_supported,
            };

            flush_category!(
                &mut flctx,
                BorderTop,
                BorderTopWidth,
                BorderTopStyle,
                BorderTopColor,
                &mut self.border_top,
                BorderBottom,
                BorderBottomWidth,
                BorderBottomStyle,
                BorderBottomColor,
                &mut self.border_bottom,
                BorderLeft,
                BorderLeftWidth,
                BorderLeftStyle,
                BorderLeftColor,
                &mut self.border_left,
                BorderRight,
                BorderRightWidth,
                BorderRightStyle,
                BorderRightColor,
                &mut self.border_right,
                is_logical = false
            );

            flush_category!(
                &mut flctx,
                BorderBlockStart,
                BorderBlockStartWidth,
                BorderBlockStartStyle,
                BorderBlockStartColor,
                &mut self.border_block_start,
                BorderBlockEnd,
                BorderBlockEndWidth,
                BorderBlockEndStyle,
                BorderBlockEndColor,
                &mut self.border_block_end,
                BorderInlineStart,
                BorderInlineStartWidth,
                BorderInlineStartStyle,
                BorderInlineStartColor,
                &mut self.border_inline_start,
                BorderInlineEnd,
                BorderInlineEndWidth,
                BorderInlineEndStyle,
                BorderInlineEndColor,
                &mut self.border_inline_end,
                is_logical = true
            );

            self.border_top.reset(arena);
            self.border_bottom.reset(arena);
            self.border_left.reset(arena);
            self.border_right.reset(arena);
            self.border_block_start.reset(arena);
            self.border_block_end.reset(arena);
            self.border_inline_start.reset(arena);
            self.border_inline_end.reset(arena);
        }

        fn flush_unparsed(
            &mut self,
            unparsed: &UnparsedProperty,
            dest: &mut DeclarationList,
            context: &mut PropertyHandlerContext,
        ) {
            let arena = dest.bump();
            let logical_supported = !context.should_compile_logical(Feature::LogicalBorders);
            if logical_supported {
                let mut up = unparsed.deep_clone(arena);
                context.add_unparsed_fallbacks(arena, &mut up);
                self.flushed_properties
                    .insert(BorderProperty::try_from_property_id(up.property_id.tag()).unwrap());
                dest.push(Property::Unparsed(up));
                return;
            }

            macro_rules! prop {
            ($id:ident) => {{
                let _ = &dest; // autofix (matches Zig: `_ = d;`)
                let mut upppppppppp =
                    unparsed.with_property_id(arena, PropertyId::$id);
                context.add_unparsed_fallbacks(arena, &mut upppppppppp);
                self.flushed_properties
                    .insert(BorderProperty::try_from_property_id(PropertyIdTag::$id).unwrap());
                // TODO(port): Zig did NOT push to dest here (likely a bug upstream) — preserved.
            }};
        }

            macro_rules! logical_prop {
                ($ltr:ident, $rtl:ident) => {{
                    context.add_logical_rule(
                        Property::Unparsed(unparsed.with_property_id(arena, PropertyId::$ltr)),
                        Property::Unparsed(unparsed.with_property_id(arena, PropertyId::$rtl)),
                    );
                }};
            }

            match unparsed.property_id.tag() {
                PropertyIdTag::BorderInlineStart => logical_prop!(BorderLeft, BorderRight),
                PropertyIdTag::BorderInlineStartWidth => {
                    logical_prop!(BorderLeftWidth, BorderRightWidth)
                }
                PropertyIdTag::BorderInlineStartColor => {
                    logical_prop!(BorderLeftColor, BorderRightColor)
                }
                PropertyIdTag::BorderInlineStartStyle => {
                    logical_prop!(BorderLeftStyle, BorderRightStyle)
                }
                PropertyIdTag::BorderInlineEnd => logical_prop!(BorderRight, BorderLeft),
                PropertyIdTag::BorderInlineEndWidth => {
                    logical_prop!(BorderRightWidth, BorderLeftWidth)
                }
                PropertyIdTag::BorderInlineEndColor => {
                    logical_prop!(BorderRightColor, BorderLeftColor)
                }
                PropertyIdTag::BorderInlineEndStyle => {
                    logical_prop!(BorderRightStyle, BorderLeftStyle)
                }
                PropertyIdTag::BorderBlockStart => prop!(BorderTop),
                PropertyIdTag::BorderBlockStartWidth => prop!(BorderTopWidth),
                PropertyIdTag::BorderBlockStartColor => prop!(BorderTopColor),
                PropertyIdTag::BorderBlockStartStyle => prop!(BorderTopStyle),
                PropertyIdTag::BorderBlockEnd => prop!(BorderBottom),
                PropertyIdTag::BorderBlockEndWidth => prop!(BorderBottomWidth),
                PropertyIdTag::BorderBlockEndColor => prop!(BorderBottomColor),
                PropertyIdTag::BorderBlockEndStyle => prop!(BorderBottomStyle),
                _ => {
                    let mut up = unparsed.deep_clone(arena);
                    context.add_unparsed_fallbacks(arena, &mut up);
                    self.flushed_properties.insert(
                        BorderProperty::try_from_property_id(up.property_id.tag()).unwrap(),
                    );
                    dest.push(Property::Unparsed(up));
                }
            }
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // is_border_property
    // ──────────────────────────────────────────────────────────────────────────

    fn is_border_property(property_id: PropertyIdTag) -> bool {
        use PropertyIdTag as P;
        matches!(
            property_id,
            P::BorderTopColor
                | P::BorderBottomColor
                | P::BorderLeftColor
                | P::BorderRightColor
                | P::BorderBlockStartColor
                | P::BorderBlockEndColor
                | P::BorderBlockColor
                | P::BorderInlineStartColor
                | P::BorderInlineEndColor
                | P::BorderInlineColor
                | P::BorderTopWidth
                | P::BorderBottomWidth
                | P::BorderLeftWidth
                | P::BorderRightWidth
                | P::BorderBlockStartWidth
                | P::BorderBlockEndWidth
                | P::BorderBlockWidth
                | P::BorderInlineStartWidth
                | P::BorderInlineEndWidth
                | P::BorderInlineWidth
                | P::BorderTopStyle
                | P::BorderBottomStyle
                | P::BorderLeftStyle
                | P::BorderRightStyle
                | P::BorderBlockStartStyle
                | P::BorderBlockEndStyle
                | P::BorderBlockStyle
                | P::BorderInlineStartStyle
                | P::BorderInlineEndStyle
                | P::BorderInlineStyle
                | P::BorderTop
                | P::BorderBottom
                | P::BorderLeft
                | P::BorderRight
                | P::BorderBlockStart
                | P::BorderBlockEnd
                | P::BorderInlineStart
                | P::BorderInlineEnd
                | P::BorderBlock
                | P::BorderInline
                | P::BorderWidth
                | P::BorderStyle
                | P::BorderColor
                | P::Border
        )
    }

    // ported from: src/css/properties/border.zig
} // mod border_handler_body
