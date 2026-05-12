#![allow(unused_imports, dead_code, unused_macros)]
#![warn(unused_must_use)]
use crate as css;
use crate::compat;
use crate::css_values::length::LengthPercentage;
use crate::prefixes::Feature;
use crate::properties::{Property, PropertyId, PropertyIdTag};
use crate::{DeclarationList, PropertyHandlerContext, VendorPrefix};
use crate::{Parser, PrintErr, Printer, Result as CssResult, Token};
use bun_alloc::ArenaVecExt as _;

use crate::css_properties::flex::{
    BoxAlign, BoxOrdinalGroup, BoxPack, FlexAlign, FlexItemAlign, FlexLinePack, FlexPack,
};

// ──────────────────────────────────────────────────────────────────────────────
// AlignContent
// ──────────────────────────────────────────────────────────────────────────────

/// A value for the [align-content](https://www.w3.org/TR/css-align-3/#propdef-align-content) property.
#[derive(Clone, PartialEq)]
// Zig: `css.DeriveParse(@This()).parse` / `css.DeriveToCss(@This()).toCss` —
// comptime-reflection generators ported as proc-macro derives.
#[derive(css::Parse, css::ToCss)]
pub enum AlignContent {
    /// Default alignment.
    Normal,
    /// A baseline position.
    BaselinePosition(BaselinePosition),
    /// A content distribution keyword.
    ContentDistribution(ContentDistribution),
    /// A content position keyword.
    ContentPosition(AlignContentContentPosition),
}

// Zig: anonymous payload struct carrying `pub fn __generateToCss() void {}` —
// the marker telling `DeriveToCss` to auto-generate the field-sequence printer.
// In Rust the equivalent is `#[derive(css::ToCss)]` on the lifted named-field
// struct (see `css_derive::expand_derive_to_css` struct branch); the enum arm's
// `__inner.to_css(dest)` then resolves to this generated inherent.
#[derive(Clone, PartialEq, css::ToCss)]
#[css(generate_to_css)]
pub struct AlignContentContentPosition {
    /// An overflow alignment mode.
    pub overflow: Option<OverflowPosition>,
    /// A content position keyword.
    pub value: ContentPosition,
}

impl AlignContentContentPosition {
    pub fn parse(input: &mut Parser) -> CssResult<Self> {
        let overflow = input.try_parse(OverflowPosition::parse).ok();
        let value = ContentPosition::parse(input)?;
        Ok(Self { overflow, value })
    }
    pub fn to_inner(&self) -> ContentPositionInner {
        ContentPositionInner {
            overflow: self.overflow,
            value: self.value,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// BaselinePosition
// ──────────────────────────────────────────────────────────────────────────────

/// A [`<baseline-position>`](https://www.w3.org/TR/css-align-3/#typedef-baseline-position) value,
/// as used in the alignment properties.
#[derive(Clone, Copy, PartialEq)]
pub enum BaselinePosition {
    /// The first baseline.
    First,
    /// The last baseline.
    Last,
}

impl BaselinePosition {
    pub fn parse(input: &mut Parser) -> CssResult<Self> {
        let location = input.current_source_location();
        let ident = input.expect_ident_cloned()?;

        crate::match_ignore_ascii_case! { ident, {
            b"baseline" => Ok(BaselinePosition::First),
            b"first" => {
                input.expect_ident_matching(b"baseline")?;
                Ok(BaselinePosition::First)
            },
            b"last" => {
                input.expect_ident_matching(b"baseline")?;
                Ok(BaselinePosition::Last)
            },
            _ => Err(location.new_unexpected_token_error(Token::Ident(ident))),
        }}
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            BaselinePosition::First => dest.write_str("baseline"),
            BaselinePosition::Last => dest.write_str("last baseline"),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// JustifyContent
// ──────────────────────────────────────────────────────────────────────────────

/// A value for the [justify-content](https://www.w3.org/TR/css-align-3/#propdef-justify-content) property.
#[derive(Clone, PartialEq)]
pub enum JustifyContent {
    /// Default justification.
    Normal,
    /// A content distribution keyword.
    ContentDistribution(ContentDistribution),
    /// A content position keyword.
    ContentPosition(JustifyContentContentPosition),
    /// Justify to the left.
    Left {
        /// An overflow alignment mode.
        overflow: Option<OverflowPosition>,
    },
    /// Justify to the right.
    Right {
        /// An overflow alignment mode.
        overflow: Option<OverflowPosition>,
    },
}

#[derive(Clone, PartialEq)]
pub struct JustifyContentContentPosition {
    /// A content position keyword.
    pub value: ContentPosition,
    /// An overflow alignment mode.
    pub overflow: Option<OverflowPosition>,
}

impl JustifyContentContentPosition {
    pub fn to_inner(&self) -> ContentPositionInner {
        ContentPositionInner {
            overflow: self.overflow,
            value: self.value,
        }
    }
}

impl JustifyContent {
    pub fn parse(input: &mut Parser) -> CssResult<Self> {
        if input
            .try_parse(|i| i.expect_ident_matching(b"normal"))
            .is_ok()
        {
            return Ok(JustifyContent::Normal);
        }

        if let Ok(val) = input.try_parse(ContentDistribution::parse) {
            return Ok(JustifyContent::ContentDistribution(val));
        }

        let overflow = input.try_parse(OverflowPosition::parse).ok();
        if let Ok(content_position) = input.try_parse(ContentPosition::parse) {
            return Ok(JustifyContent::ContentPosition(
                JustifyContentContentPosition {
                    overflow,
                    value: content_position,
                },
            ));
        }

        let location = input.current_source_location();
        let ident = input.expect_ident_cloned()?;

        crate::match_ignore_ascii_case! { ident, {
            b"left" => Ok(JustifyContent::Left { overflow }),
            b"right" => Ok(JustifyContent::Right { overflow }),
            _ => Err(location.new_unexpected_token_error(Token::Ident(ident))),
        }}
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            JustifyContent::Normal => dest.write_str("normal"),
            JustifyContent::ContentDistribution(value) => value.to_css(dest),
            JustifyContent::ContentPosition(cp) => {
                if let Some(overflow) = &cp.overflow {
                    overflow.to_css(dest)?;
                    dest.write_str(" ")?;
                }
                cp.value.to_css(dest)
            }
            JustifyContent::Left { overflow } => {
                if let Some(overflow) = overflow {
                    overflow.to_css(dest)?;
                    dest.write_str(" ")?;
                }
                dest.write_str("left")
            }
            JustifyContent::Right { overflow } => {
                if let Some(overflow) = overflow {
                    overflow.to_css(dest)?;
                    dest.write_str(" ")?;
                }
                dest.write_str("right")
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// AlignSelf
// ──────────────────────────────────────────────────────────────────────────────

/// A value for the [align-self](https://www.w3.org/TR/css-align-3/#align-self-property) property.
#[derive(Clone, PartialEq)]
// Zig: `css.DeriveParse` / `css.DeriveToCss`
#[derive(css::Parse, css::ToCss)]
pub enum AlignSelf {
    /// Automatic alignment.
    Auto,
    /// Default alignment.
    Normal,
    /// Item is stretched.
    Stretch,
    /// A baseline position keyword.
    BaselinePosition(BaselinePosition),
    /// A self position keyword.
    SelfPosition(AlignSelfSelfPosition),
}

// Zig: `__generateToCss` marker — see `AlignContentContentPosition` note.
#[derive(Clone, PartialEq, css::ToCss)]
#[css(generate_to_css)]
pub struct AlignSelfSelfPosition {
    /// An overflow alignment mode.
    pub overflow: Option<OverflowPosition>,
    /// A self position keyword.
    pub value: SelfPosition,
}

impl AlignSelfSelfPosition {
    pub fn to_inner(&self) -> SelfPositionInner {
        SelfPositionInner {
            overflow: self.overflow,
            value: self.value,
        }
    }

    pub fn parse(input: &mut Parser) -> CssResult<Self> {
        let overflow = input.try_parse(OverflowPosition::parse).ok();
        let self_position = SelfPosition::parse(input)?;
        Ok(Self {
            overflow,
            value: self_position,
        })
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// JustifySelf
// ──────────────────────────────────────────────────────────────────────────────

/// A value for the [justify-self](https://www.w3.org/TR/css-align-3/#justify-self-property) property.
#[derive(Clone, PartialEq)]
pub enum JustifySelf {
    /// Automatic justification.
    Auto,
    /// Default justification.
    Normal,
    /// Item is stretched.
    Stretch,
    /// A baseline position keyword.
    BaselinePosition(BaselinePosition),
    /// A self position keyword.
    SelfPosition(JustifySelfSelfPosition),
    /// Item is justified to the left.
    Left {
        /// An overflow alignment mode.
        overflow: Option<OverflowPosition>,
    },
    /// Item is justified to the right.
    Right {
        /// An overflow alignment mode.
        overflow: Option<OverflowPosition>,
    },
}

#[derive(Clone, PartialEq)]
pub struct JustifySelfSelfPosition {
    /// A self position keyword.
    pub value: SelfPosition,
    /// An overflow alignment mode.
    pub overflow: Option<OverflowPosition>,
}

impl JustifySelfSelfPosition {
    pub fn to_inner(&self) -> SelfPositionInner {
        SelfPositionInner {
            overflow: self.overflow,
            value: self.value,
        }
    }
}

impl JustifySelf {
    pub fn parse(input: &mut Parser) -> CssResult<Self> {
        if input
            .try_parse(|i| i.expect_ident_matching(b"auto"))
            .is_ok()
        {
            return Ok(JustifySelf::Auto);
        }

        if input
            .try_parse(|i| i.expect_ident_matching(b"normal"))
            .is_ok()
        {
            return Ok(JustifySelf::Normal);
        }

        if input
            .try_parse(|i| i.expect_ident_matching(b"stretch"))
            .is_ok()
        {
            return Ok(JustifySelf::Stretch);
        }

        if let Ok(val) = input.try_parse(BaselinePosition::parse) {
            return Ok(JustifySelf::BaselinePosition(val));
        }

        let overflow = input.try_parse(OverflowPosition::parse).ok();
        if let Ok(self_position) = input.try_parse(SelfPosition::parse) {
            return Ok(JustifySelf::SelfPosition(JustifySelfSelfPosition {
                overflow,
                value: self_position,
            }));
        }

        let location = input.current_source_location();
        let ident = input.expect_ident_cloned()?;
        crate::match_ignore_ascii_case! { ident, {
            b"left" => Ok(JustifySelf::Left { overflow }),
            b"right" => Ok(JustifySelf::Right { overflow }),
            _ => Err(location.new_unexpected_token_error(Token::Ident(ident))),
        }}
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            JustifySelf::Auto => dest.write_str("auto"),
            JustifySelf::Normal => dest.write_str("normal"),
            JustifySelf::Stretch => dest.write_str("stretch"),
            JustifySelf::BaselinePosition(baseline_position) => baseline_position.to_css(dest),
            JustifySelf::SelfPosition(self_position) => {
                if let Some(overflow) = &self_position.overflow {
                    overflow.to_css(dest)?;
                    dest.write_str(" ")?;
                }
                self_position.value.to_css(dest)
            }
            JustifySelf::Left { overflow } => {
                if let Some(overflow) = overflow {
                    overflow.to_css(dest)?;
                    dest.write_str(" ")?;
                }
                dest.write_str("left")
            }
            JustifySelf::Right { overflow } => {
                if let Some(overflow) = overflow {
                    overflow.to_css(dest)?;
                    dest.write_str(" ")?;
                }
                dest.write_str("right")
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// AlignItems
// ──────────────────────────────────────────────────────────────────────────────

/// A value for the [align-items](https://www.w3.org/TR/css-align-3/#align-items-property) property.
#[derive(Clone, PartialEq)]
// Zig: `css.DeriveParse` / `css.DeriveToCss`
#[derive(css::Parse, css::ToCss)]
pub enum AlignItems {
    /// Default alignment.
    Normal,
    /// Items are stretched.
    Stretch,
    /// A baseline position keyword.
    BaselinePosition(BaselinePosition),
    /// A self position keyword.
    SelfPosition(AlignItemsSelfPosition),
}

// Zig: `__generateToCss` marker — see `AlignContentContentPosition` note.
#[derive(Clone, PartialEq, css::ToCss)]
#[css(generate_to_css)]
pub struct AlignItemsSelfPosition {
    /// An overflow alignment mode.
    pub overflow: Option<OverflowPosition>,
    /// A self position keyword.
    pub value: SelfPosition,
}

impl AlignItemsSelfPosition {
    pub fn to_inner(&self) -> SelfPositionInner {
        SelfPositionInner {
            overflow: self.overflow,
            value: self.value,
        }
    }

    pub fn parse(input: &mut Parser) -> CssResult<Self> {
        let overflow = input.try_parse(OverflowPosition::parse).ok();
        let self_position = SelfPosition::parse(input)?;
        Ok(Self {
            overflow,
            value: self_position,
        })
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// JustifyItems
// ──────────────────────────────────────────────────────────────────────────────

/// A value for the [justify-items](https://www.w3.org/TR/css-align-3/#justify-items-property) property.
#[derive(Clone, PartialEq)]
pub enum JustifyItems {
    /// Default justification.
    Normal,
    /// Items are stretched.
    Stretch,
    /// A baseline position keyword.
    BaselinePosition(BaselinePosition),
    /// A self position keyword, with optional overflow position.
    SelfPosition(JustifyItemsSelfPosition),
    /// Items are justified to the left, with an optional overflow position.
    Left {
        /// An overflow alignment mode.
        overflow: Option<OverflowPosition>,
    },
    /// Items are justified to the right, with an optional overflow position.
    Right {
        /// An overflow alignment mode.
        overflow: Option<OverflowPosition>,
    },
    /// A legacy justification keyword.
    Legacy(LegacyJustify),
}

#[derive(Clone, PartialEq)]
pub struct JustifyItemsSelfPosition {
    /// A self position keyword.
    pub value: SelfPosition,
    /// An overflow alignment mode.
    pub overflow: Option<OverflowPosition>,
}

impl JustifyItemsSelfPosition {
    pub fn to_inner(&self) -> SelfPositionInner {
        SelfPositionInner {
            overflow: self.overflow,
            value: self.value,
        }
    }
}

impl JustifyItems {
    pub fn parse(input: &mut Parser) -> CssResult<Self> {
        if input
            .try_parse(|i| i.expect_ident_matching(b"normal"))
            .is_ok()
        {
            return Ok(JustifyItems::Normal);
        }

        if input
            .try_parse(|i| i.expect_ident_matching(b"stretch"))
            .is_ok()
        {
            return Ok(JustifyItems::Stretch);
        }

        if let Ok(val) = input.try_parse(BaselinePosition::parse) {
            return Ok(JustifyItems::BaselinePosition(val));
        }

        if let Ok(val) = input.try_parse(LegacyJustify::parse) {
            return Ok(JustifyItems::Legacy(val));
        }

        let overflow = input.try_parse(OverflowPosition::parse).ok();
        if let Ok(self_position) = input.try_parse(SelfPosition::parse) {
            return Ok(JustifyItems::SelfPosition(JustifyItemsSelfPosition {
                overflow,
                value: self_position,
            }));
        }

        let location = input.current_source_location();
        let ident = input.expect_ident_cloned()?;

        crate::match_ignore_ascii_case! { ident, {
            b"left" => Ok(JustifyItems::Left { overflow }),
            b"right" => Ok(JustifyItems::Right { overflow }),
            _ => Err(location.new_unexpected_token_error(Token::Ident(ident))),
        }}
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            JustifyItems::Normal => dest.write_str("normal"),
            JustifyItems::Stretch => dest.write_str("stretch"),
            JustifyItems::BaselinePosition(val) => val.to_css(dest),
            JustifyItems::SelfPosition(sp) => {
                if let Some(overflow) = &sp.overflow {
                    overflow.to_css(dest)?;
                    dest.write_str(" ")?;
                }
                sp.value.to_css(dest)
            }
            JustifyItems::Left { overflow } => {
                if let Some(overflow) = overflow {
                    overflow.to_css(dest)?;
                    dest.write_str(" ")?;
                }
                dest.write_str("left")
            }
            JustifyItems::Right { overflow } => {
                if let Some(overflow) = overflow {
                    overflow.to_css(dest)?;
                    dest.write_str(" ")?;
                }
                dest.write_str("right")
            }
            JustifyItems::Legacy(l) => l.to_css(dest),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// LegacyJustify
// ──────────────────────────────────────────────────────────────────────────────

/// A legacy justification keyword, as used in the `justify-items` property.
#[derive(Clone, Copy, PartialEq)]
pub enum LegacyJustify {
    /// Left justify.
    Left,
    /// Right justify.
    Right,
    /// Centered.
    Center,
}

impl LegacyJustify {
    pub fn parse(input: &mut Parser) -> CssResult<Self> {
        let location = input.current_source_location();
        let ident = input.expect_ident_cloned()?;

        crate::match_ignore_ascii_case! { ident, {
            b"legacy" => {
                let inner_location = input.current_source_location();
                let inner_ident = input.expect_ident_cloned()?;
                crate::match_ignore_ascii_case! { inner_ident, {
                    b"left" => Ok(LegacyJustify::Left),
                    b"right" => Ok(LegacyJustify::Right),
                    b"center" => Ok(LegacyJustify::Center),
                    _ => Err(inner_location.new_unexpected_token_error(Token::Ident(inner_ident))),
                }}
            },
            b"left" => {
                input.expect_ident_matching(b"legacy")?;
                Ok(LegacyJustify::Left)
            },
            b"right" => {
                input.expect_ident_matching(b"legacy")?;
                Ok(LegacyJustify::Right)
            },
            b"center" => {
                input.expect_ident_matching(b"legacy")?;
                Ok(LegacyJustify::Center)
            },
            _ => Err(location.new_unexpected_token_error(Token::Ident(ident))),
        }}
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        dest.write_str("legacy ")?;
        match self {
            LegacyJustify::Left => dest.write_str("left"),
            LegacyJustify::Right => dest.write_str("right"),
            LegacyJustify::Center => dest.write_str("center"),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// GapValue / Gap
// ──────────────────────────────────────────────────────────────────────────────

/// A [gap](https://www.w3.org/TR/css-align-3/#column-row-gap) value, as used in the
/// `column-gap` and `row-gap` properties.
#[derive(Clone, PartialEq)]
// Zig: `css.DeriveParse` / `css.DeriveToCss`
#[derive(css::Parse, css::ToCss)]
pub enum GapValue {
    /// Equal to `1em` for multi-column containers, and zero otherwise.
    Normal,
    /// An explicit length.
    LengthPercentage(LengthPercentage),
}

/// A value for the [gap](https://www.w3.org/TR/css-align-3/#gap-shorthand) shorthand property.
#[derive(Clone, PartialEq)]
pub struct Gap {
    /// The row gap.
    pub row: GapValue,
    /// The column gap.
    pub column: GapValue,
}

impl Gap {
    // TODO(port): PropertyFieldMap was a comptime struct mapping fields → CSS property names
    // (.row = "row-gap", .column = "column-gap"). Encode as derive attrs in Phase B.

    pub fn parse(input: &mut Parser) -> CssResult<Self> {
        let row = GapValue::parse(input)?;
        let column = input
            .try_parse(GapValue::parse)
            .unwrap_or_else(|_| row.clone());
        Ok(Self { row, column })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        self.row.to_css(dest)?;
        if self.column != self.row {
            dest.write_str(" ")?;
            self.column.to_css(dest)?;
        }
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// PlaceItems
// ──────────────────────────────────────────────────────────────────────────────

/// A value for the [place-items](https://www.w3.org/TR/css-align-3/#place-items-property) shorthand property.
#[derive(Clone, PartialEq)]
pub struct PlaceItems {
    /// The item alignment.
    pub align: AlignItems,
    /// The item justification.
    pub justify: JustifyItems,
}

impl PlaceItems {
    // TODO(port): PropertyFieldMap (.align = "align-items", .justify = "justify-items")
    // TODO(port): VendorPrefixMap (.align = true)

    pub fn parse(input: &mut Parser) -> CssResult<Self> {
        let align = AlignItems::parse(input)?;
        let justify = match input.try_parse(JustifyItems::parse) {
            Ok(v) => v,
            Err(_) => match &align {
                AlignItems::Normal => JustifyItems::Normal,
                AlignItems::Stretch => JustifyItems::Stretch,
                AlignItems::BaselinePosition(p) => JustifyItems::BaselinePosition(*p),
                AlignItems::SelfPosition(sp) => {
                    JustifyItems::SelfPosition(JustifyItemsSelfPosition {
                        overflow: sp.overflow,
                        value: sp.value,
                    })
                }
            },
        };

        Ok(Self { align, justify })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        self.align.to_css(dest)?;
        let is_equal = match &self.justify {
            JustifyItems::Normal => self.align == AlignItems::Normal,
            JustifyItems::Stretch => self.align == AlignItems::Stretch,
            JustifyItems::BaselinePosition(p) => 'brk: {
                if let AlignItems::BaselinePosition(ap) = &self.align {
                    break 'brk p == ap;
                }
                false
            }
            JustifyItems::SelfPosition(p) => 'brk: {
                if let AlignItems::SelfPosition(ap) = &self.align {
                    break 'brk p.to_inner() == ap.to_inner();
                }
                false
            }
            _ => false,
        };

        if !is_equal {
            dest.write_str(" ")?;
            self.justify.to_css(dest)?;
        }
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// PlaceSelf
// ──────────────────────────────────────────────────────────────────────────────

/// A value for the [place-self](https://www.w3.org/TR/css-align-3/#place-self-property) shorthand property.
#[derive(Clone, PartialEq)]
pub struct PlaceSelf {
    /// The item alignment.
    pub align: AlignSelf,
    /// The item justification.
    pub justify: JustifySelf,
}

impl PlaceSelf {
    // TODO(port): PropertyFieldMap (.align = "align-self", .justify = "justify-self")
    // TODO(port): VendorPrefixMap (.align = true)

    pub fn parse(input: &mut Parser) -> CssResult<Self> {
        let align = AlignSelf::parse(input)?;
        let justify = match input.try_parse(JustifySelf::parse) {
            Ok(v) => v,
            Err(_) => match &align {
                AlignSelf::Auto => JustifySelf::Auto,
                AlignSelf::Normal => JustifySelf::Normal,
                AlignSelf::Stretch => JustifySelf::Stretch,
                AlignSelf::BaselinePosition(p) => JustifySelf::BaselinePosition(*p),
                AlignSelf::SelfPosition(sp) => JustifySelf::SelfPosition(JustifySelfSelfPosition {
                    overflow: sp.overflow,
                    value: sp.value,
                }),
            },
        };

        Ok(Self { align, justify })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        self.align.to_css(dest)?;
        let is_equal = match &self.justify {
            JustifySelf::Auto => true,
            JustifySelf::Normal => matches!(self.align, AlignSelf::Normal),
            JustifySelf::Stretch => matches!(self.align, AlignSelf::Stretch),
            JustifySelf::BaselinePosition(p) => match &self.align {
                AlignSelf::BaselinePosition(p2) => p == p2,
                _ => false,
            },
            JustifySelf::SelfPosition(sp) => 'brk: {
                if let AlignSelf::SelfPosition(ap) = &self.align {
                    break 'brk sp.to_inner() == ap.to_inner();
                }
                false
            }
            _ => false,
        };

        if !is_equal {
            dest.write_str(" ")?;
            self.justify.to_css(dest)?;
        }
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// SelfPosition
// ──────────────────────────────────────────────────────────────────────────────

/// A [`<self-position>`](https://www.w3.org/TR/css-align-3/#typedef-self-position) value.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
// TODO(port): css.DefineEnumProperty — derive-based eql/hash/parse/toCss/deepClone for plain enums.
#[derive(css::DefineEnumProperty)]
pub enum SelfPosition {
    /// Item is centered within the container.
    #[css(name = "center")]
    Center,
    /// Item is aligned to the start of the container.
    #[css(name = "start")]
    Start,
    /// Item is aligned to the end of the container.
    #[css(name = "end")]
    End,
    /// Item is aligned to the edge of the container corresponding to the start side of the item.
    #[css(name = "self-start")]
    SelfStart,
    /// Item is aligned to the edge of the container corresponding to the end side of the item.
    #[css(name = "self-end")]
    SelfEnd,
    /// Item  is aligned to the start of the container, within flexbox layouts.
    #[css(name = "flex-start")]
    FlexStart,
    /// Item  is aligned to the end of the container, within flexbox layouts.
    #[css(name = "flex-end")]
    FlexEnd,
}

// ──────────────────────────────────────────────────────────────────────────────
// PlaceContent
// ──────────────────────────────────────────────────────────────────────────────

/// A value for the [place-content](https://www.w3.org/TR/css-align-3/#place-content) shorthand property.
#[derive(Clone, PartialEq)]
pub struct PlaceContent {
    /// The content alignment.
    pub align: AlignContent,
    /// The content justification.
    pub justify: JustifyContent,
}

impl PlaceContent {
    // TODO(port): PropertyFieldMap (.align = PropertyIdTag::AlignContent, .justify = PropertyIdTag::JustifyContent)
    // TODO(port): VendorPrefixMap (.align = true, .justify = true)

    pub fn parse(input: &mut Parser) -> CssResult<Self> {
        let align = AlignContent::parse(input)?;
        let justify = match JustifyContent::parse(input) {
            Ok(v) => v,
            Err(_) => match &align {
                AlignContent::BaselinePosition(_) => {
                    JustifyContent::ContentPosition(JustifyContentContentPosition {
                        overflow: None,
                        value: ContentPosition::Start,
                    })
                }
                AlignContent::Normal => JustifyContent::Normal,
                AlignContent::ContentDistribution(value) => {
                    JustifyContent::ContentDistribution(*value)
                }
                AlignContent::ContentPosition(pos) => {
                    JustifyContent::ContentPosition(JustifyContentContentPosition {
                        overflow: pos.overflow.clone(),
                        value: pos.value.clone(),
                    })
                }
            },
        };

        Ok(Self { align, justify })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        self.align.to_css(dest)?;
        let is_equal = match &self.justify {
            JustifyContent::Normal => 'brk: {
                if matches!(self.align, AlignContent::Normal) {
                    break 'brk true;
                }
                false
            }
            JustifyContent::ContentDistribution(d) => 'brk: {
                if let AlignContent::ContentDistribution(ad) = &self.align {
                    break 'brk d == ad;
                }
                false
            }
            JustifyContent::ContentPosition(p) => 'brk: {
                if let AlignContent::ContentPosition(ap) = &self.align {
                    break 'brk p.to_inner() == ap.to_inner();
                }
                false
            }
            _ => false,
        };

        if !is_equal {
            dest.write_str(" ")?;
            self.justify.to_css(dest)?;
        }
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// ContentDistribution / OverflowPosition / ContentPosition
// ──────────────────────────────────────────────────────────────────────────────

/// A [`<content-distribution>`](https://www.w3.org/TR/css-align-3/#typedef-content-distribution) value.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
// TODO(port): css.DefineEnumProperty
#[derive(css::DefineEnumProperty)]
pub enum ContentDistribution {
    /// Items are spaced evenly, with the first and last items against the edge of the container.
    #[css(name = "space-between")]
    SpaceBetween,
    /// Items are spaced evenly, with half-size spaces at the start and end.
    #[css(name = "space-around")]
    SpaceAround,
    /// Items are spaced evenly, with full-size spaces at the start and end.
    #[css(name = "space-evenly")]
    SpaceEvenly,
    /// Items are stretched evenly to fill free space.
    #[css(name = "stretch")]
    Stretch,
}

/// An [`<overflow-position>`](https://www.w3.org/TR/css-align-3/#typedef-overflow-position) value.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
// TODO(port): css.DefineEnumProperty
#[derive(css::DefineEnumProperty)]
pub enum OverflowPosition {
    /// If the size of the alignment subject overflows the alignment container,
    /// the alignment subject is instead aligned as if the alignment mode were start.
    #[css(name = "safe")]
    Safe,
    /// Regardless of the relative sizes of the alignment subject and alignment
    /// container, the given alignment value is honored.
    #[css(name = "unsafe")]
    Unsafe,
}

/// A [`<content-position>`](https://www.w3.org/TR/css-align-3/#typedef-content-position) value.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
// TODO(port): css.DefineEnumProperty
#[derive(css::DefineEnumProperty)]
pub enum ContentPosition {
    /// Content is centered within the container.
    #[css(name = "center")]
    Center,
    /// Content is aligned to the start of the container.
    #[css(name = "start")]
    Start,
    /// Content is aligned to the end of the container.
    #[css(name = "end")]
    End,
    /// Same as `start` when within a flexbox container.
    #[css(name = "flex-start")]
    FlexStart,
    /// Same as `end` when within a flexbox container.
    #[css(name = "flex-end")]
    FlexEnd,
}

// ──────────────────────────────────────────────────────────────────────────────
// SelfPositionInner / ContentPositionInner
// ──────────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq)]
pub struct SelfPositionInner {
    /// An overflow alignment mode.
    pub overflow: Option<OverflowPosition>,
    /// A self position keyword.
    pub value: SelfPosition,
}

#[derive(Clone, Copy, PartialEq)]
pub struct ContentPositionInner {
    /// An overflow alignment mode.
    pub overflow: Option<OverflowPosition>,
    /// A content position keyword.
    pub value: ContentPosition,
}

// ──────────────────────────────────────────────────────────────────────────────
// AlignHandler
// ──────────────────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct AlignHandler {
    pub align_content: Option<(AlignContent, VendorPrefix)>,
    pub flex_line_pack: Option<(FlexLinePack, VendorPrefix)>,
    pub justify_content: Option<(JustifyContent, VendorPrefix)>,
    pub box_pack: Option<(BoxPack, VendorPrefix)>,
    pub flex_pack: Option<(FlexPack, VendorPrefix)>,
    pub align_self: Option<(AlignSelf, VendorPrefix)>,
    pub flex_item_align: Option<(FlexItemAlign, VendorPrefix)>,
    pub justify_self: Option<JustifySelf>,
    pub align_items: Option<(AlignItems, VendorPrefix)>,
    pub box_align: Option<(BoxAlign, VendorPrefix)>,
    pub flex_align: Option<(FlexAlign, VendorPrefix)>,
    pub justify_items: Option<JustifyItems>,
    pub row_gap: Option<GapValue>,
    pub column_gap: Option<GapValue>,
    pub has_any: bool,
}

// ─── helper macros (Zig used `comptime prop: []const u8` + `@field` / `@unionInit`) ───
//
// TODO(port): the Zig source threads field names as comptime strings into helper fns
// and uses @field/@unionInit for reflection. Rust cannot pass field names as values, so
// these are macro_rules! that expand at each call site. Phase B may want to dedupe via
// a small proc-macro if maintenance burden is high.

macro_rules! handle_property_maybe_flush {
    ($this:expr, $dest:expr, $context:expr, $field:ident, $val:expr, $vp:expr) => {{
        // If two vendor prefixes for the same property have different
        // values, we need to flush what we have immediately to preserve order.
        if let Some(v) = &$this.$field {
            if !($val == &v.0) && !v.1.contains($vp) {
                $this.flush($dest, $context);
            }
        }
    }};
}

macro_rules! handle_property_helper {
    ($this:expr, $dest:expr, $context:expr, $field:ident, $val:expr, $vp:expr) => {{
        handle_property_maybe_flush!($this, $dest, $context, $field, $val, $vp);
        // Otherwise, update the value and add the prefix.
        if let Some(tuple) = &mut $this.$field {
            tuple.0 = ($val).clone();
            tuple.1.insert($vp);
        } else {
            $this.$field = Some((($val).clone(), $vp));
            $this.has_any = true;
        }
    }};
}

macro_rules! flush_prefixed_property {
    ($dest:expr, $context:expr, $variant:ident, $key:expr) => {{
        if let Some((val, prefix)) = $key {
            $dest.push(Property::$variant((val, prefix)));
        }
    }};
}

macro_rules! flush_unprefix_property {
    ($dest:expr, $context:expr, $variant:ident, $key:expr) => {{
        if let Some(val) = $key {
            $dest.push(Property::$variant(val));
        }
    }};
}

macro_rules! flush_standard_property_helper {
    ($this:expr, $dest:expr, $context:expr, $variant:ident, $key:expr, $feature:expr) => {{
        if let Some((val, prefix)) = $key {
            // If we have an unprefixed property, override necessary prefixes.
            let prefix = if prefix.contains(VendorPrefix::NONE) {
                $this.flush_prefixes_helper($context, $feature)
            } else {
                prefix
            };
            $dest.push(Property::$variant((val, prefix)));
        }
    }};
}

// PORT NOTE: un-gated B-2 round 15 — flex::{BoxPack,FlexPack,BoxAlign,FlexAlign,
// FlexItemAlign,FlexLinePack}::from_standard + prefixes::Feature::is_flex_2009 are real now.
macro_rules! flush_legacy_property {
    // variant with both 2009 and 2012
    ($dest:expr, $context:expr, $feature:expr, $key:expr, prop_2009: ($ty2009:ty, $variant2009:ident), prop_2012: ($ty2012:ty, $variant2012:ident)) => {{
        if let Some((val, prefix)) = &*$key {
            // If we have an unprefixed standard property, generate legacy prefixed versions.
            let mut prefix = $context.targets.prefixes(*prefix, $feature);

            if prefix.contains(VendorPrefix::NONE) {
                // 2009 spec, implemented by webkit and firefox.
                if let Some(targets) = $context.targets.browsers {
                    let mut prefixes_2009 = VendorPrefix::empty();
                    if Feature::is_flex_2009(targets) {
                        prefixes_2009.insert(VendorPrefix::WEBKIT);
                    }
                    if prefix.contains(VendorPrefix::MOZ) {
                        prefixes_2009.insert(VendorPrefix::MOZ);
                    }
                    if !prefixes_2009.is_empty() {
                        // TODO(port): Zig branched on `T == BoxOrdinalGroup` to bypass
                        // from_standard. Never true at any callsite in this file; preserved
                        // as a note in case the macro is reused elsewhere.
                        let s = <$ty2009>::from_standard(val);
                        if let Some(a) = s {
                            $dest.push(Property::$variant2009((a, prefixes_2009)));
                        }
                    }
                }
            }

            // 2012 spec, implemented by microsoft.
            if prefix.contains(VendorPrefix::MS) {
                let s = <$ty2012>::from_standard(val);
                if let Some(q) = s {
                    $dest.push(Property::$variant2012((q, VendorPrefix::MS)));
                }
            }

            // Remove Firefox and IE from standard prefixes.
            prefix.remove(VendorPrefix::MOZ);
            prefix.remove(VendorPrefix::MS);
            let _ = prefix;
        }
    }};
    // variant with only 2012
    ($dest:expr, $context:expr, $feature:expr, $key:expr, prop_2009: None, prop_2012: ($ty2012:ty, $variant2012:ident)) => {{
        if let Some((val, prefix)) = &*$key {
            let mut prefix = $context.targets.prefixes(*prefix, $feature);

            // 2012 spec, implemented by microsoft.
            if prefix.contains(VendorPrefix::MS) {
                let s = <$ty2012>::from_standard(val);
                if let Some(q) = s {
                    $dest.push(Property::$variant2012((q, VendorPrefix::MS)));
                }
            }

            prefix.remove(VendorPrefix::MOZ);
            prefix.remove(VendorPrefix::MS);
            let _ = prefix;
        }
    }};
}

macro_rules! flush_shorthand_helper {
    // justify_prop is Some
    (
        $this:expr, $dest:expr, $context:expr,
        prop: ($prop_variant:ident, $prop_ty:ty),
        align_prop: ($align_feature:expr, $align_variant:ident),
        $align_val:expr,
        $justify_val:expr,
        justify_prop: ($justify_feature:expr, $justify_variant:ident)
    ) => {{
        // Only use shorthand if both align and justify are present
        if let Some((align, align_prefix)) = &mut *$align_val {
            if let Some((justify_actual, justify_prefix)) = &mut *$justify_val {
                let intersection = *align_prefix & *justify_prefix;
                // Only use shorthand if unprefixed.
                if intersection.contains(VendorPrefix::NONE) {
                    // Add prefixed longhands if needed.
                    *align_prefix = $this.flush_prefixes_helper($context, $align_feature);
                    align_prefix.remove(VendorPrefix::NONE);
                    if !align_prefix.is_empty() {
                        $dest.push(Property::$align_variant((align.clone(), *align_prefix)));
                    }

                    *justify_prefix = $this.flush_prefixes_helper($context, $justify_feature);
                    justify_prefix.remove(VendorPrefix::NONE);

                    if !justify_prefix.is_empty() {
                        $dest.push(Property::$justify_variant((
                            justify_actual.clone(),
                            *justify_prefix,
                        )));
                    }

                    // Add shorthand.
                    $dest.push(Property::$prop_variant(<$prop_ty>::from_align_justify(
                        align.clone(),
                        justify_actual.clone(),
                    )));
                    // TODO(port): Zig built `prop.ty{ .align = ..., .justify = ... }` directly.
                    // Using a `from_align_justify` ctor here; Phase B can inline struct init.

                    *$align_val = None;
                    *$justify_val = None;
                }
            }
        }
    }};
    // justify_prop is None — justify_val is Option<T> (no VendorPrefix)
    (
        $this:expr, $dest:expr, $context:expr,
        prop: ($prop_variant:ident, $prop_ty:ty),
        align_prop: ($align_feature:expr, $align_variant:ident),
        $align_val:expr,
        $justify_val:expr,
        justify_prop: None
    ) => {{
        if let Some((align, align_prefix)) = &mut *$align_val {
            if let Some(justify) = &mut *$justify_val {
                // Zig: intersection = align_prefix & align_prefix (justify has no prefix)
                let intersection = *align_prefix;
                if intersection.contains(VendorPrefix::NONE) {
                    *align_prefix = $this.flush_prefixes_helper($context, $align_feature);
                    align_prefix.remove(VendorPrefix::NONE);
                    if !align_prefix.is_empty() {
                        $dest.push(Property::$align_variant((align.clone(), *align_prefix)));
                    }

                    // Add shorthand.
                    $dest.push(Property::$prop_variant(<$prop_ty>::from_align_justify(
                        align.clone(),
                        justify.clone(),
                    )));
                    // TODO(port): see note above re: from_align_justify ctor.

                    *$align_val = None;
                    *$justify_val = None;
                }
            }
        }
    }};
}

// Tiny ctors used by flush_shorthand_helper! above.
// TODO(port): inline as struct literals once Property variant shapes are settled.
impl PlaceContent {
    fn from_align_justify(align: AlignContent, justify: JustifyContent) -> Self {
        Self { align, justify }
    }
}
impl PlaceSelf {
    fn from_align_justify(align: AlignSelf, justify: JustifySelf) -> Self {
        Self { align, justify }
    }
}
impl PlaceItems {
    fn from_align_justify(align: AlignItems, justify: JustifyItems) -> Self {
        Self { align, justify }
    }
}

impl AlignHandler {
    pub fn handle_property(
        &mut self,
        property: &Property,
        dest: &mut DeclarationList<'_>,
        context: &mut PropertyHandlerContext<'_>,
    ) -> bool {
        match property {
            Property::AlignContent((val, vp)) => {
                self.flex_line_pack = None;
                handle_property_helper!(self, dest, context, align_content, val, *vp);
            }
            Property::FlexLinePack((val, vp)) => {
                handle_property_helper!(self, dest, context, flex_line_pack, val, *vp);
            }
            Property::JustifyContent((val, vp)) => {
                self.box_pack = None;
                self.flex_pack = None;
                handle_property_helper!(self, dest, context, justify_content, val, *vp);
            }
            Property::BoxPack((val, vp)) => {
                handle_property_helper!(self, dest, context, box_pack, val, *vp);
            }
            Property::FlexPack((val, vp)) => {
                handle_property_helper!(self, dest, context, flex_pack, val, *vp);
            }
            Property::PlaceContent(val) => {
                self.flex_line_pack = None;
                self.box_pack = None;
                self.flex_pack = None;
                handle_property_maybe_flush!(
                    self,
                    dest,
                    context,
                    align_content,
                    &val.align,
                    VendorPrefix::NONE
                );
                handle_property_maybe_flush!(
                    self,
                    dest,
                    context,
                    justify_content,
                    &val.justify,
                    VendorPrefix::NONE
                );
                handle_property_helper!(
                    self,
                    dest,
                    context,
                    align_content,
                    &val.align,
                    VendorPrefix::NONE
                );
                handle_property_helper!(
                    self,
                    dest,
                    context,
                    justify_content,
                    &val.justify,
                    VendorPrefix::NONE
                );
            }
            Property::AlignSelf((val, vp)) => {
                self.flex_item_align = None;
                handle_property_helper!(self, dest, context, align_self, val, *vp);
            }
            Property::FlexItemAlign((val, vp)) => {
                handle_property_helper!(self, dest, context, flex_item_align, val, *vp);
            }
            Property::JustifySelf(val) => {
                self.justify_self = Some(val.clone());
                self.has_any = true;
            }
            Property::PlaceSelf(val) => {
                self.flex_item_align = None;
                handle_property_helper!(
                    self,
                    dest,
                    context,
                    align_self,
                    &val.align,
                    VendorPrefix::NONE
                );
                self.justify_self = Some(val.justify.clone());
            }
            Property::AlignItems((val, vp)) => {
                self.box_align = None;
                self.flex_align = None;
                handle_property_helper!(self, dest, context, align_items, val, *vp);
            }
            Property::BoxAlign((val, vp)) => {
                handle_property_helper!(self, dest, context, box_align, val, *vp);
            }
            Property::FlexAlign((val, vp)) => {
                handle_property_helper!(self, dest, context, flex_align, val, *vp);
            }
            Property::JustifyItems(val) => {
                self.justify_items = Some(val.clone());
                self.has_any = true;
            }
            Property::PlaceItems(val) => {
                self.box_align = None;
                self.flex_align = None;
                handle_property_helper!(
                    self,
                    dest,
                    context,
                    align_items,
                    &val.align,
                    VendorPrefix::NONE
                );
                self.justify_items = Some(val.justify.clone());
            }
            Property::RowGap(val) => {
                self.row_gap = Some(val.clone());
                self.has_any = true;
            }
            Property::ColumnGap(val) => {
                self.column_gap = Some(val.clone());
                self.has_any = true;
            }
            Property::Gap(val) => {
                self.row_gap = Some(val.row.clone());
                self.column_gap = Some(val.column.clone());
                self.has_any = true;
            }
            Property::Unparsed(val) => {
                if is_align_property(&val.property_id) {
                    self.flush(dest, context);
                    // PORT NOTE: Zig pushed `property.deepClone(context.arena)`. `Property`
                    // has no blanket `Clone` yet; reconstruct from the matched payload (same as flex.rs).
                    let bump = dest.bump();
                    dest.push(Property::Unparsed(val.deep_clone(bump)));
                } else {
                    return false;
                }
            }
            _ => return false,
        }

        true
    }

    pub fn finalize(
        &mut self,
        dest: &mut DeclarationList<'_>,
        context: &mut PropertyHandlerContext<'_>,
    ) {
        self.flush(dest, context);
    }

    fn flush(&mut self, dest: &mut DeclarationList<'_>, context: &mut PropertyHandlerContext<'_>) {
        if !self.has_any {
            return;
        }

        self.has_any = false;

        let mut align_content = self.align_content.take();
        let mut justify_content = self.justify_content.take();
        let mut align_self = self.align_self.take();
        let mut justify_self = self.justify_self.take();
        let mut align_items = self.align_items.take();
        let mut justify_items = self.justify_items.take();
        let row_gap = self.row_gap.take();
        let column_gap = self.column_gap.take();
        let box_align = self.box_align.take();
        let box_pack = self.box_pack.take();
        let flex_line_pack = self.flex_line_pack.take();
        let flex_pack = self.flex_pack.take();
        let flex_align = self.flex_align.take();
        let flex_item_align = self.flex_item_align.take();

        // 2009 properties
        flush_prefixed_property!(dest, context, BoxAlign, box_align);
        flush_prefixed_property!(dest, context, BoxPack, box_pack);

        // 2012 properties
        flush_prefixed_property!(dest, context, FlexPack, flex_pack);
        flush_prefixed_property!(dest, context, FlexAlign, flex_align);
        flush_prefixed_property!(dest, context, FlexItemAlign, flex_item_align);
        flush_prefixed_property!(dest, context, FlexLinePack, flex_line_pack);

        flush_legacy_property!(dest, context, Feature::AlignContent, &align_content, prop_2009: None, prop_2012: (FlexLinePack, FlexLinePack));
        flush_legacy_property!(dest, context, Feature::JustifyContent, &justify_content, prop_2009: (BoxPack, BoxPack), prop_2012: (FlexPack, FlexPack));
        if context.targets.is_compatible(compat::Feature::PlaceContent) {
            flush_shorthand_helper!(
                self, dest, context,
                prop: (PlaceContent, PlaceContent),
                align_prop: (Feature::AlignContent, AlignContent),
                &mut align_content,
                &mut justify_content,
                justify_prop: (Feature::JustifyContent, JustifyContent)
            );
        }
        flush_standard_property_helper!(
            self,
            dest,
            context,
            AlignContent,
            align_content.take(),
            Feature::AlignContent
        );
        flush_standard_property_helper!(
            self,
            dest,
            context,
            JustifyContent,
            justify_content.take(),
            Feature::JustifyContent
        );

        flush_legacy_property!(dest, context, Feature::AlignSelf, &align_self, prop_2009: None, prop_2012: (FlexItemAlign, FlexItemAlign));
        if context.targets.is_compatible(compat::Feature::PlaceSelf) {
            flush_shorthand_helper!(
                self, dest, context,
                prop: (PlaceSelf, PlaceSelf),
                align_prop: (Feature::AlignSelf, AlignSelf),
                &mut align_self,
                &mut justify_self,
                justify_prop: None
            );
        }
        flush_standard_property_helper!(
            self,
            dest,
            context,
            AlignSelf,
            align_self.take(),
            Feature::AlignSelf
        );
        flush_unprefix_property!(dest, context, JustifySelf, justify_self.take());

        flush_legacy_property!(dest, context, Feature::AlignItems, &align_items, prop_2009: (BoxAlign, BoxAlign), prop_2012: (FlexAlign, FlexAlign));
        if context.targets.is_compatible(compat::Feature::PlaceItems) {
            flush_shorthand_helper!(
                self, dest, context,
                prop: (PlaceItems, PlaceItems),
                align_prop: (Feature::AlignItems, AlignItems),
                &mut align_items,
                &mut justify_items,
                justify_prop: None
            );
        }
        flush_standard_property_helper!(
            self,
            dest,
            context,
            AlignItems,
            align_items.take(),
            Feature::AlignItems
        );
        flush_unprefix_property!(dest, context, JustifyItems, justify_items.take());

        match (row_gap, column_gap) {
            (Some(row), Some(column)) => dest.push(Property::Gap(Gap { row, column })),
            (row, column) => {
                if let Some(row) = row {
                    dest.push(Property::RowGap(row));
                }
                if let Some(column) = column {
                    dest.push(Property::ColumnGap(column));
                }
            }
        }
    }

    /// Gets prefixes for standard properties.
    // PERF(port): was comptime monomorphization (`comptime feature: Feature`) — profile in Phase B
    fn flush_prefixes_helper(
        &self,
        context: &PropertyHandlerContext<'_>,
        feature: Feature,
    ) -> VendorPrefix {
        let mut prefix = context.targets.prefixes(VendorPrefix::NONE, feature);
        // Firefox only implemented the 2009 spec prefixed.
        // Microsoft only implemented the 2012 spec prefixed.
        prefix.remove(VendorPrefix::MOZ);
        prefix.remove(VendorPrefix::MS);
        prefix
    }
}

fn is_align_property(property_id: &PropertyId) -> bool {
    matches!(
        property_id,
        PropertyId::AlignContent(_)
            | PropertyId::FlexLinePack(_)
            | PropertyId::JustifyContent(_)
            | PropertyId::BoxPack(_)
            | PropertyId::FlexPack(_)
            | PropertyId::PlaceContent
            | PropertyId::AlignSelf(_)
            | PropertyId::FlexItemAlign(_)
            | PropertyId::JustifySelf
            | PropertyId::PlaceSelf
            | PropertyId::AlignItems(_)
            | PropertyId::BoxAlign(_)
            | PropertyId::FlexAlign(_)
            | PropertyId::JustifyItems
            | PropertyId::PlaceItems
            | PropertyId::RowGap
            | PropertyId::ColumnGap
            | PropertyId::Gap
    )
}

// ported from: src/css/properties/align.zig
