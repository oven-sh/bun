#![allow(unused_imports, dead_code, unused_macros)]
#![warn(unused_must_use)]
use crate as css;
use bun_alloc::ArenaVecExt as _;

use crate::properties::{Property, PropertyId, PropertyIdTag};
use css::css_properties::align::{AlignContent, AlignItems, AlignSelf, JustifyContent};
use css::css_values::length::LengthValue as Length;
use css::css_values::length::{LengthPercentage, LengthPercentageOrAuto};
use css::css_values::number::{CSSInteger, CSSNumber, CSSNumberFns};
use css::prefixes::Feature as PrefixFeature;
use css::{PrintErr, Printer, VendorPrefix};
// Zig: `const isFlex2009 = css.prefixes.Feature.isFlex2009;`
use css::prefixes::is_flex_2009;

/// A value for the [flex-direction](https://www.w3.org/TR/2018/CR-css-flexbox-1-20181119/#propdef-flex-direction) property.
/// A value for the [flex-direction](https://www.w3.org/TR/2018/CR-css-flexbox-1-20181119/#propdef-flex-direction) property.
#[derive(Clone, Copy, PartialEq, Eq, Hash, css::DefineEnumProperty)]
// TODO(port): css::DefineEnumProperty derive provides parse/to_css/eql/hash/deep_clone over kebab-case variant names
pub enum FlexDirection {
    /// Flex items are laid out in a row.
    Row,
    /// Flex items are laid out in a row, and reversed.
    RowReverse,
    /// Flex items are laid out in a column.
    Column,
    /// Flex items are laid out in a column, and reversed.
    ColumnReverse,
}

impl Default for FlexDirection {
    fn default() -> FlexDirection {
        FlexDirection::Row
    }
}

impl FlexDirection {
    pub fn to_2009(&self) -> (BoxOrient, BoxDirection) {
        match *self {
            FlexDirection::Row => (BoxOrient::Horizontal, BoxDirection::Normal),
            FlexDirection::Column => (BoxOrient::Vertical, BoxDirection::Normal),
            FlexDirection::RowReverse => (BoxOrient::Horizontal, BoxDirection::Reverse),
            FlexDirection::ColumnReverse => (BoxOrient::Vertical, BoxDirection::Reverse),
        }
    }
}

/// A value for the [flex-wrap](https://www.w3.org/TR/2018/CR-css-flexbox-1-20181119/#flex-wrap-property) property.
/// A value for the [flex-wrap](https://www.w3.org/TR/2018/CR-css-flexbox-1-20181119/#flex-wrap-property) property.
#[derive(Clone, Copy, PartialEq, Eq, Hash, css::DefineEnumProperty)]
pub enum FlexWrap {
    /// The flex items do not wrap.
    Nowrap,
    /// The flex items wrap.
    Wrap,
    /// The flex items wrap, in reverse.
    WrapReverse,
}

impl Default for FlexWrap {
    fn default() -> FlexWrap {
        FlexWrap::Nowrap
    }
}

impl FlexWrap {
    pub fn from_standard(&self) -> Option<FlexWrap> {
        Some(*self)
    }
}

/// A value for the [flex-flow](https://www.w3.org/TR/2018/CR-css-flexbox-1-20181119/#flex-flow-property) shorthand property.
#[derive(Clone, PartialEq)]
pub struct FlexFlow {
    /// The direction that flex items flow.
    pub direction: FlexDirection,
    /// How the flex items wrap.
    pub wrap: FlexWrap,
}

// (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"flex-flow", PropertyFieldMap);
// TODO(port): PropertyFieldMap / VendorPrefixMap are comptime shorthand metadata consumed by
// css::DefineShorthand reflection. Port as part of the shorthand derive in Phase B.
//   PropertyFieldMap = { direction: PropertyIdTag::FlexDirection, wrap: PropertyIdTag::FlexWrap }
//   VendorPrefixMap  = { direction: true, wrap: true }

impl FlexFlow {
    pub fn parse(input: &mut css::Parser) -> css::Result<Self> {
        let mut direction: Option<FlexDirection> = None;
        let mut wrap: Option<FlexWrap> = None;

        loop {
            if direction.is_none() {
                if let Ok(value) = input.try_parse(FlexDirection::parse) {
                    direction = Some(value);
                    continue;
                }
            }
            if wrap.is_none() {
                if let Ok(value) = input.try_parse(FlexWrap::parse) {
                    wrap = Some(value);
                    continue;
                }
            }
            break;
        }

        Ok(FlexFlow {
            direction: direction.unwrap_or(FlexDirection::Row),
            wrap: wrap.unwrap_or(FlexWrap::Nowrap),
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        let mut needs_space = false;
        if self.direction != FlexDirection::default() || self.wrap == FlexWrap::default() {
            self.direction.to_css(dest)?;
            needs_space = true;
        }

        if self.wrap != FlexWrap::default() {
            if needs_space {
                dest.write_str(" ")?;
            }
            self.wrap.to_css(dest)?;
        }

        Ok(())
    }
}

/// A value for the [flex](https://www.w3.org/TR/2018/CR-css-flexbox-1-20181119/#flex-property) shorthand property.
/// A value for the [flex](https://www.w3.org/TR/2018/CR-css-flexbox-1-20181119/#flex-property) shorthand property.
#[derive(Clone, PartialEq)]
pub struct Flex {
    /// The flex grow factor.
    pub grow: CSSNumber,
    /// The flex shrink factor.
    pub shrink: CSSNumber,
    /// The flex basis.
    pub basis: LengthPercentageOrAuto,
}

// (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.flex, PropertyFieldMap);
// TODO(port): PropertyFieldMap / VendorPrefixMap shorthand metadata — see FlexFlow note.
//   PropertyFieldMap = { grow: PropertyIdTag::FlexGrow, shrink: PropertyIdTag::FlexShrink, basis: PropertyIdTag::FlexBasis }
//   VendorPrefixMap  = { grow: true, shrink: true, basis: true }

impl Flex {
    pub fn parse(input: &mut css::Parser) -> css::Result<Self> {
        if input
            .try_parse(|i| i.expect_ident_matching(b"none"))
            .is_ok()
        {
            return Ok(Flex {
                grow: 0.0,
                shrink: 0.0,
                basis: LengthPercentageOrAuto::Auto,
            });
        }

        let mut grow: Option<CSSNumber> = None;
        let mut shrink: Option<CSSNumber> = None;
        let mut basis: Option<LengthPercentageOrAuto> = None;

        loop {
            if grow.is_none() {
                if let Ok(value) = input.try_parse(CSSNumberFns::parse) {
                    grow = Some(value);
                    shrink = input.try_parse(CSSNumberFns::parse).ok();
                    continue;
                }
            }

            if basis.is_none() {
                if let Ok(value) = input.try_parse(LengthPercentageOrAuto::parse) {
                    basis = Some(value);
                    continue;
                }
            }

            break;
        }

        Ok(Flex {
            grow: grow.unwrap_or(1.0),
            shrink: shrink.unwrap_or(1.0),
            basis: basis.unwrap_or(LengthPercentageOrAuto::Length(
                LengthPercentage::Percentage(css::css_values::percentage::Percentage { v: 0.0 }),
            )),
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        if self.grow == 0.0
            && self.shrink == 0.0
            && matches!(self.basis, LengthPercentageOrAuto::Auto)
        {
            dest.write_str("none")?;
            return Ok(());
        }

        #[derive(PartialEq, Eq)]
        enum ZeroKind {
            NonZero,
            Length,
            Percentage,
        }

        // If the basis is unitless 0, we must write all three components to disambiguate.
        // If the basis is 0%, we can omit the basis.
        let basis_kind = match &self.basis {
            LengthPercentageOrAuto::Length(lp) => 'brk: {
                if let LengthPercentage::Dimension(d) = lp {
                    if d.is_zero() {
                        break 'brk ZeroKind::Length;
                    }
                }
                if let LengthPercentage::Percentage(p) = lp {
                    if p.is_zero() {
                        break 'brk ZeroKind::Percentage;
                    }
                }
                ZeroKind::NonZero
            }
            _ => ZeroKind::NonZero,
        };

        if self.grow != 1.0 || self.shrink != 1.0 || basis_kind != ZeroKind::NonZero {
            CSSNumberFns::to_css(&self.grow, dest)?;
            if self.shrink != 1.0 || basis_kind == ZeroKind::Length {
                dest.write_str(" ")?;
                CSSNumberFns::to_css(&self.shrink, dest)?;
            }
        }

        if basis_kind != ZeroKind::Percentage {
            if self.grow != 1.0 || self.shrink != 1.0 || basis_kind == ZeroKind::Length {
                dest.write_str(" ")?;
            }
            self.basis.to_css(dest)?;
        }

        Ok(())
    }
}

/// A value for the legacy (prefixed) [box-orient](https://www.w3.org/TR/2009/WD-css3-flexbox-20090723/#orientation) property.
/// Partially equivalent to `flex-direction` in the standard syntax.
/// A value for the legacy (prefixed) [box-orient](https://www.w3.org/TR/2009/WD-css3-flexbox-20090723/#orientation) property.
/// Partially equivalent to `flex-direction` in the standard syntax.
#[derive(Clone, Copy, PartialEq, Eq, Hash, css::DefineEnumProperty)]
pub enum BoxOrient {
    /// Items are laid out horizontally.
    Horizontal,
    /// Items are laid out vertically.
    Vertical,
    /// Items are laid out along the inline axis, according to the writing direction.
    InlineAxis,
    /// Items are laid out along the block axis, according to the writing direction.
    BlockAxis,
}

/// A value for the legacy (prefixed) [box-direction](https://www.w3.org/TR/2009/WD-css3-flexbox-20090723/#displayorder) property.
/// Partially equivalent to the `flex-direction` property in the standard syntax.
#[derive(Clone, Copy, PartialEq, Eq, Hash, css::DefineEnumProperty)]
pub enum BoxDirection {
    /// Items flow in the natural direction.
    Normal,
    /// Items flow in the reverse direction.
    Reverse,
}

pub type FlexAlign = BoxAlign;

/// A value for the legacy (prefixed) [box-align](https://www.w3.org/TR/2009/WD-css3-flexbox-20090723/#alignment) property.
/// Equivalent to the `align-items` property in the standard syntax.
/// A value for the legacy (prefixed) [box-align](https://www.w3.org/TR/2009/WD-css3-flexbox-20090723/#alignment) property.
/// Equivalent to the `align-items` property in the standard syntax.
#[derive(Clone, Copy, PartialEq, Eq, Hash, css::DefineEnumProperty)]
pub enum BoxAlign {
    /// Items are aligned to the start.
    Start,
    /// Items are aligned to the end.
    End,
    /// Items are centered.
    Center,
    /// Items are aligned to the baseline.
    Baseline,
    /// Items are stretched.
    Stretch,
}

// un-gated B-2 round 9: align payload shapes are real now —{AlignItems,SelfPosition} payload shapes
impl BoxAlign {
    pub fn from_standard(align: &AlignItems) -> Option<BoxAlign> {
        use css::css_properties::align::SelfPosition;
        match align {
            AlignItems::SelfPosition(sp) => {
                if sp.overflow.is_none() {
                    match sp.value {
                        SelfPosition::Start | SelfPosition::FlexStart => Some(BoxAlign::Start),
                        SelfPosition::End | SelfPosition::FlexEnd => Some(BoxAlign::End),
                        SelfPosition::Center => Some(BoxAlign::Center),
                        _ => None,
                    }
                } else {
                    None
                }
            }
            AlignItems::Stretch => Some(BoxAlign::Stretch),
            _ => None,
        }
    }
}

/// A value for the legacy (prefixed) [box-pack](https://www.w3.org/TR/2009/WD-css3-flexbox-20090723/#packing) property.
/// Equivalent to the `justify-content` property in the standard syntax.
/// A value for the legacy (prefixed) [box-pack](https://www.w3.org/TR/2009/WD-css3-flexbox-20090723/#packing) property.
/// Equivalent to the `justify-content` property in the standard syntax.
#[derive(Clone, Copy, PartialEq, Eq, Hash, css::DefineEnumProperty)]
pub enum BoxPack {
    /// Items are justified to the start.
    Start,
    /// Items are justified to the end.
    End,
    /// Items are centered.
    Center,
    /// Items are justified to the start and end.
    Justify,
}

// un-gated B-2 round 9: align payload shapes are real now —{JustifyContent,ContentPosition} payload shapes
impl BoxPack {
    pub fn from_standard(justify: &JustifyContent) -> Option<BoxPack> {
        use css::css_properties::align::{ContentDistribution, ContentPosition};
        match justify {
            JustifyContent::ContentDistribution(cd) => match cd {
                ContentDistribution::SpaceBetween => Some(BoxPack::Justify),
                _ => None,
            },
            JustifyContent::ContentPosition(cp) => {
                if cp.overflow.is_none() {
                    match cp.value {
                        ContentPosition::Start | ContentPosition::FlexStart => Some(BoxPack::Start),
                        ContentPosition::End | ContentPosition::FlexEnd => Some(BoxPack::End),
                        ContentPosition::Center => Some(BoxPack::Center),
                    }
                } else {
                    None
                }
            }
            _ => None,
        }
    }
}

/// A value for the legacy (prefixed) [box-lines](https://www.w3.org/TR/2009/WD-css3-flexbox-20090723/#multiple) property.
/// Equivalent to the `flex-wrap` property in the standard syntax.
/// A value for the legacy (prefixed) [box-lines](https://www.w3.org/TR/2009/WD-css3-flexbox-20090723/#multiple) property.
/// Equivalent to the `flex-wrap` property in the standard syntax.
#[derive(Clone, Copy, PartialEq, Eq, Hash, css::DefineEnumProperty)]
pub enum BoxLines {
    /// Items are laid out in a single line.
    Single,
    /// Items may wrap into multiple lines.
    Multiple,
}

impl BoxLines {
    pub fn from_standard(wrap: &FlexWrap) -> Option<BoxLines> {
        match *wrap {
            FlexWrap::Nowrap => Some(BoxLines::Single),
            FlexWrap::Wrap => Some(BoxLines::Multiple),
            _ => None,
        }
    }
}

// Old flex (2012): https://www.w3.org/TR/2012/WD-css3-flexbox-20120322/
/// A value for the legacy (prefixed) [flex-pack](https://www.w3.org/TR/2012/WD-css3-flexbox-20120322/#flex-pack) property.
/// Equivalent to the `justify-content` property in the standard syntax.
/// A value for the legacy (prefixed) [flex-pack](https://www.w3.org/TR/2012/WD-css3-flexbox-20120322/#flex-pack) property.
/// Equivalent to the `justify-content` property in the standard syntax.
#[derive(Clone, Copy, PartialEq, Eq, Hash, css::DefineEnumProperty)]
pub enum FlexPack {
    /// Items are justified to the start.
    Start,
    /// Items are justified to the end.
    End,
    /// Items are centered.
    Center,
    /// Items are justified to the start and end.
    Justify,
    /// Items are distributed evenly, with half size spaces on either end.
    Distribute,
}

// un-gated B-2 round 9: align payload shapes are real now —{JustifyContent,ContentDistribution} payload shapes
impl FlexPack {
    pub fn from_standard(justify: &JustifyContent) -> Option<FlexPack> {
        use css::css_properties::align::{ContentDistribution, ContentPosition};
        match justify {
            JustifyContent::ContentDistribution(cd) => match cd {
                ContentDistribution::SpaceBetween => Some(FlexPack::Justify),
                ContentDistribution::SpaceAround => Some(FlexPack::Distribute),
                _ => None,
            },
            JustifyContent::ContentPosition(cp) => {
                if cp.overflow.is_none() {
                    match cp.value {
                        ContentPosition::Start | ContentPosition::FlexStart => {
                            Some(FlexPack::Start)
                        }
                        ContentPosition::End | ContentPosition::FlexEnd => Some(FlexPack::End),
                        ContentPosition::Center => Some(FlexPack::Center),
                    }
                } else {
                    None
                }
            }
            _ => None,
        }
    }
}

/// A value for the legacy (prefixed) [flex-item-align](https://www.w3.org/TR/2012/WD-css3-flexbox-20120322/#flex-align) property.
/// Equivalent to the `align-self` property in the standard syntax.
/// A value for the legacy (prefixed) [flex-item-align](https://www.w3.org/TR/2012/WD-css3-flexbox-20120322/#flex-align) property.
/// Equivalent to the `align-self` property in the standard syntax.
#[derive(Clone, Copy, PartialEq, Eq, Hash, css::DefineEnumProperty)]
pub enum FlexItemAlign {
    /// Equivalent to the value of `flex-align`.
    Auto,
    /// The item is aligned to the start.
    Start,
    /// The item is aligned to the end.
    End,
    /// The item is centered.
    Center,
    /// The item is aligned to the baseline.
    Baseline,
    /// The item is stretched.
    Stretch,
}

// un-gated B-2 round 9: align payload shapes are real now —{AlignSelf,SelfPosition} payload shapes
impl FlexItemAlign {
    pub fn from_standard(justify: &AlignSelf) -> Option<FlexItemAlign> {
        use css::css_properties::align::SelfPosition;
        match justify {
            AlignSelf::Auto => Some(FlexItemAlign::Auto),
            AlignSelf::Stretch => Some(FlexItemAlign::Stretch),
            AlignSelf::SelfPosition(sp) => {
                if sp.overflow.is_none() {
                    match sp.value {
                        SelfPosition::Start | SelfPosition::FlexStart => Some(FlexItemAlign::Start),
                        SelfPosition::End | SelfPosition::FlexEnd => Some(FlexItemAlign::End),
                        SelfPosition::Center => Some(FlexItemAlign::Center),
                        _ => None,
                    }
                } else {
                    None
                }
            }
            _ => None,
        }
    }
}

/// A value for the legacy (prefixed) [flex-line-pack](https://www.w3.org/TR/2012/WD-css3-flexbox-20120322/#flex-line-pack) property.
/// Equivalent to the `align-content` property in the standard syntax.
/// A value for the legacy (prefixed) [flex-line-pack](https://www.w3.org/TR/2012/WD-css3-flexbox-20120322/#flex-line-pack) property.
/// Equivalent to the `align-content` property in the standard syntax.
#[derive(Clone, Copy, PartialEq, Eq, Hash, css::DefineEnumProperty)]
pub enum FlexLinePack {
    /// Content is aligned to the start.
    Start,
    /// Content is aligned to the end.
    End,
    /// Content is centered.
    Center,
    /// Content is justified.
    Justify,
    /// Content is distributed evenly, with half size spaces on either end.
    Distribute,
    /// Content is stretched.
    Stretch,
}

// un-gated B-2 round 9: align payload shapes are real now —{AlignContent,ContentDistribution} payload shapes
impl FlexLinePack {
    pub fn from_standard(justify: &AlignContent) -> Option<FlexLinePack> {
        use css::css_properties::align::{ContentDistribution, ContentPosition};
        match justify {
            AlignContent::ContentDistribution(cd) => match cd {
                ContentDistribution::SpaceBetween => Some(FlexLinePack::Justify),
                ContentDistribution::SpaceAround => Some(FlexLinePack::Distribute),
                ContentDistribution::Stretch => Some(FlexLinePack::Stretch),
                _ => None,
            },
            AlignContent::ContentPosition(cp) => {
                if cp.overflow.is_none() {
                    match cp.value {
                        ContentPosition::Start | ContentPosition::FlexStart => {
                            Some(FlexLinePack::Start)
                        }
                        ContentPosition::End | ContentPosition::FlexEnd => Some(FlexLinePack::End),
                        ContentPosition::Center => Some(FlexLinePack::Center),
                    }
                } else {
                    None
                }
            }
            _ => None,
        }
    }
}

pub type BoxOrdinalGroup = CSSInteger;

// A handler for flex-related properties that manages both standard and legacy vendor prefixed values.
#[derive(Default)]
pub struct FlexHandler {
    /// The flex-direction property value and vendor prefix
    pub direction: Option<(FlexDirection, VendorPrefix)>,
    /// The box-orient property value and vendor prefix (legacy)
    pub box_orient: Option<(BoxOrient, VendorPrefix)>,
    /// The box-direction property value and vendor prefix (legacy)
    pub box_direction: Option<(BoxDirection, VendorPrefix)>,
    /// The flex-wrap property value and vendor prefix
    pub wrap: Option<(FlexWrap, VendorPrefix)>,
    /// The box-lines property value and vendor prefix (legacy)
    pub box_lines: Option<(BoxLines, VendorPrefix)>,
    /// The flex-grow property value and vendor prefix
    pub grow: Option<(CSSNumber, VendorPrefix)>,
    /// The box-flex property value and vendor prefix (legacy)
    pub box_flex: Option<(CSSNumber, VendorPrefix)>,
    /// The flex-positive property value and vendor prefix (legacy)
    pub flex_positive: Option<(CSSNumber, VendorPrefix)>,
    /// The flex-shrink property value and vendor prefix
    pub shrink: Option<(CSSNumber, VendorPrefix)>,
    /// The flex-negative property value and vendor prefix (legacy)
    pub flex_negative: Option<(CSSNumber, VendorPrefix)>,
    /// The flex-basis property value and vendor prefix
    pub basis: Option<(LengthPercentageOrAuto, VendorPrefix)>,
    /// The preferred-size property value and vendor prefix (legacy)
    pub preferred_size: Option<(LengthPercentageOrAuto, VendorPrefix)>,
    /// The order property value and vendor prefix
    pub order: Option<(CSSInteger, VendorPrefix)>,
    /// The box-ordinal-group property value and vendor prefix (legacy)
    pub box_ordinal_group: Option<(BoxOrdinalGroup, VendorPrefix)>,
    /// The flex-order property value and vendor prefix (legacy)
    pub flex_order: Option<(CSSInteger, VendorPrefix)>,
    /// Whether any flex-related properties have been set
    pub has_any: bool,
}

impl FlexHandler {
    pub fn handle_property(
        &mut self,
        property: &Property,
        dest: &mut css::DeclarationList,
        context: &mut css::PropertyHandlerContext,
    ) -> bool {
        // TODO(port): Zig used local closures with `@field(self, prop)` comptime reflection.
        // Ported as macro_rules! token-pasting on field idents.
        macro_rules! maybe_flush {
            ($prop:ident, $val:expr, $vp:expr) => {{
                // If two vendor prefixes for the same property have different
                // values, we need to flush what we have immediately to preserve order.
                if let Some(field) = &self.$prop {
                    if !(field.0 == *$val) && !field.1.contains(*$vp) {
                        self.flush(dest, context);
                    }
                }
            }};
        }

        macro_rules! property_helper {
            ($prop:ident, $val:expr, $vp:expr) => {{
                maybe_flush!($prop, $val, $vp);

                // Otherwise, update the value and add the prefix
                // PORT NOTE: Zig threaded `context.arena` into `css.generic.deepClone`;
                // every payload here is `Clone` (Copy enums / f32 / i32 / LengthPercentageOrAuto),
                // so `.clone()` is the faithful equivalent.
                if let Some(field) = &mut self.$prop {
                    field.0 = ($val).clone();
                    field.1.insert(*$vp);
                } else {
                    self.$prop = Some((($val).clone(), *$vp));
                    self.has_any = true;
                }
            }};
        }

        match property {
            Property::FlexDirection(val) => {
                if context.targets.browsers.is_some() {
                    self.box_direction = None;
                    self.box_orient = None;
                }
                property_helper!(direction, &val.0, &val.1);
            }
            Property::BoxOrient(val) => property_helper!(box_orient, &val.0, &val.1),
            Property::BoxDirection(val) => property_helper!(box_direction, &val.0, &val.1),
            Property::FlexWrap(val) => {
                if context.targets.browsers.is_some() {
                    self.box_lines = None;
                }
                property_helper!(wrap, &val.0, &val.1);
            }
            Property::BoxLines(val) => property_helper!(box_lines, &val.0, &val.1),
            Property::FlexFlow(val) => {
                if context.targets.browsers.is_some() {
                    self.box_direction = None;
                    self.box_orient = None;
                }
                property_helper!(direction, &val.0.direction, &val.1);
                property_helper!(wrap, &val.0.wrap, &val.1);
            }
            Property::FlexGrow(val) => {
                if context.targets.browsers.is_some() {
                    self.box_flex = None;
                    self.flex_positive = None;
                }
                property_helper!(grow, &val.0, &val.1);
            }
            Property::BoxFlex(val) => property_helper!(box_flex, &val.0, &val.1),
            Property::FlexPositive(val) => property_helper!(flex_positive, &val.0, &val.1),
            Property::FlexShrink(val) => {
                if context.targets.browsers.is_some() {
                    self.flex_negative = None;
                }
                property_helper!(shrink, &val.0, &val.1);
            }
            Property::FlexNegative(val) => property_helper!(flex_negative, &val.0, &val.1),
            Property::FlexBasis(val) => {
                if context.targets.browsers.is_some() {
                    self.preferred_size = None;
                }
                property_helper!(basis, &val.0, &val.1);
            }
            Property::FlexPreferredSize(val) => property_helper!(preferred_size, &val.0, &val.1),
            Property::Flex(val) => {
                if context.targets.browsers.is_some() {
                    self.box_flex = None;
                    self.flex_positive = None;
                    self.flex_negative = None;
                    self.preferred_size = None;
                }
                maybe_flush!(grow, &val.0.grow, &val.1);
                maybe_flush!(shrink, &val.0.shrink, &val.1);
                maybe_flush!(basis, &val.0.basis, &val.1);
                property_helper!(grow, &val.0.grow, &val.1);
                property_helper!(shrink, &val.0.shrink, &val.1);
                property_helper!(basis, &val.0.basis, &val.1);
            }
            Property::Order(val) => {
                if context.targets.browsers.is_some() {
                    self.box_ordinal_group = None;
                    self.flex_order = None;
                }
                property_helper!(order, &val.0, &val.1);
            }
            Property::BoxOrdinalGroup(val) => property_helper!(box_ordinal_group, &val.0, &val.1),
            Property::FlexOrder(val) => property_helper!(flex_order, &val.0, &val.1),
            Property::Unparsed(val) => {
                if Self::is_flex_property(&val.property_id) {
                    self.flush(dest, context);
                    // PORT NOTE: Zig pushed `property.deepClone(context.arena)`. `Property`
                    // has no blanket `deep_clone` yet; reconstruct from the matched payload.
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
        dest: &mut css::DeclarationList,
        context: &mut css::PropertyHandlerContext,
    ) {
        self.flush(dest, context);
    }

    fn flush(
        &mut self,
        dest: &mut css::DeclarationList,
        context: &mut css::PropertyHandlerContext,
    ) {
        if !self.has_any {
            return;
        }

        self.has_any = false;

        let mut direction: Option<(FlexDirection, VendorPrefix)> = self.direction.take();
        let mut wrap: Option<(FlexWrap, VendorPrefix)> = self.wrap.take();
        let mut grow: Option<(CSSNumber, VendorPrefix)> = self.grow.take();
        let mut shrink: Option<(CSSNumber, VendorPrefix)> = self.shrink.take();
        let mut basis = self.basis.take();
        let mut box_orient = self.box_orient.take();
        let mut box_direction = self.box_direction.take();
        let mut box_flex = self.box_flex.take();
        let mut box_ordinal_group = self.box_ordinal_group.take();
        let mut box_lines = self.box_lines.take();
        let mut flex_positive = self.flex_positive.take();
        let mut flex_negative = self.flex_negative.take();
        let mut preferred_size = self.preferred_size.take();
        let mut order = self.order.take();
        let mut flex_order = self.flex_order.take();

        // TODO(port): Zig `legacyProperty` / `singleProperty` use `@unionInit(Property, name, ...)`
        // (comptime token-pasting). Ported as macro_rules! taking the Property variant ident.
        macro_rules! legacy_property {
            ($variant:ident, $key:expr) => {{
                if let Some(value) = $key {
                    let val = value.0;
                    let prefix = value.1;
                    if !prefix.is_empty() {
                        dest.push(Property::$variant((val, prefix)));
                    } else {
                        // css.generic.eql(comptime T: type, lhs: *const T, rhs: *const T)
                        // css.generic.deinit(@TypeOf(val), &val, ctx.arena);
                    }
                }
            }};
        }

        // Legacy properties. These are only set if the final standard properties were unset.
        legacy_property!(BoxOrient, box_orient.take());
        legacy_property!(BoxDirection, box_direction.take());
        legacy_property!(BoxOrdinalGroup, box_ordinal_group.take());
        legacy_property!(BoxFlex, box_flex.take());
        legacy_property!(BoxLines, box_lines.take());
        legacy_property!(FlexPositive, flex_positive.take());
        legacy_property!(FlexNegative, flex_negative.take());
        legacy_property!(FlexPreferredSize, preferred_size.take());
        legacy_property!(FlexOrder, flex_order.take());

        if let Some(val) = &direction {
            let dir = val.0;
            if let Some(targets) = &context.targets.browsers {
                let prefixes = context
                    .targets
                    .prefixes(VendorPrefix::NONE, PrefixFeature::FlexDirection);
                let mut prefixes_2009 = VendorPrefix::empty();
                if is_flex_2009(*targets) {
                    prefixes_2009.insert(VendorPrefix::WEBKIT);
                }
                if prefixes.contains(VendorPrefix::MOZ) {
                    prefixes_2009.insert(VendorPrefix::MOZ);
                }
                if !prefixes_2009.is_empty() {
                    let (orient, newdir) = dir.to_2009();
                    dest.push(Property::BoxOrient((orient, prefixes_2009)));
                    dest.push(Property::BoxDirection((newdir, prefixes_2009)));
                }
            }
        }

        if direction.is_some() && wrap.is_some() {
            // PORT NOTE: reshaped for borrowck — Zig took simultaneous &mut into both Options.
            let dir_val = direction.as_mut().unwrap();
            let wrap_val = wrap.as_mut().unwrap();
            let dir: &FlexDirection = &dir_val.0;
            let dir_prefix: &mut VendorPrefix = &mut dir_val.1;
            let wrapinner: &FlexWrap = &wrap_val.0;
            let wrap_prefix: &mut VendorPrefix = &mut wrap_val.1;

            let intersection = dir_prefix.intersection(*wrap_prefix);
            if !intersection.is_empty() {
                let mut prefix = context
                    .targets
                    .prefixes(intersection, PrefixFeature::FlexFlow);
                // Firefox only implemented the 2009 spec prefixed.
                prefix.remove(VendorPrefix::MOZ);
                dest.push(Property::FlexFlow((
                    FlexFlow {
                        direction: *dir,
                        wrap: *wrapinner,
                    },
                    prefix,
                )));
                dir_prefix.remove(intersection);
                wrap_prefix.remove(intersection);
            }
        }

        macro_rules! single_property {
            // prop_2009 = None
            ($variant:ident, $key:expr, prop_2012 = None, prop_2009 = None, feature = $feature:ident) => {{
                single_property!(@inner $variant, $key, $feature, |_val, _prefix, _prefixes_2009| {}, |_val, prefix: &mut VendorPrefix| {});
            }};
            // prop_2012 = Some, prop_2009 = None
            ($variant:ident, $key:expr, prop_2012 = $p2012:ident, prop_2009 = None, feature = $feature:ident) => {{
                single_property!(@inner $variant, $key, $feature, |_val, _prefix, _prefixes_2009| {}, |val, prefix: &mut VendorPrefix| {
                    let mut ms = true;
                    if prefix.contains(VendorPrefix::MS) {
                        dest.push(Property::$p2012((val, VendorPrefix::MS)));
                        ms = false;
                    }
                    if !ms {
                        prefix.remove(VendorPrefix::MS);
                    }
                });
            }};
            // prop_2012 = None, prop_2009 = Some(Type, Variant)
            ($variant:ident, $key:expr, prop_2012 = None, prop_2009 = ($ty2009:ty, $v2009:ident), feature = $feature:ident) => {{
                single_property!(@inner $variant, $key, $feature, |val, _prefix, prefixes_2009: VendorPrefix| {
                    let s = <$ty2009>::from_standard(&val);
                    if let Some(v) = s {
                        dest.push(Property::$v2009((v, prefixes_2009)));
                    }
                }, |_val, prefix: &mut VendorPrefix| {});
            }};
            // prop_2012 = Some, prop_2009 = BoxOrdinalGroup special case
            ($variant:ident, $key:expr, prop_2012 = $p2012:ident, prop_2009 = (BoxOrdinalGroup, $v2009:ident), feature = $feature:ident) => {{
                single_property!(@inner $variant, $key, $feature, |val, _prefix, prefixes_2009: VendorPrefix| {
                    // Zig: if T == BoxOrdinalGroup -> Some(val as i32)
                    let s: Option<i32> = Some(val);
                    if let Some(v) = s {
                        dest.push(Property::$v2009((v, prefixes_2009)));
                    }
                }, |val, prefix: &mut VendorPrefix| {
                    let mut ms = true;
                    if prefix.contains(VendorPrefix::MS) {
                        dest.push(Property::$p2012((val, VendorPrefix::MS)));
                        ms = false;
                    }
                    if !ms {
                        prefix.remove(VendorPrefix::MS);
                    }
                });
            }};
            (@inner $variant:ident, $key:expr, $feature:ident, $body_2009:expr, $body_2012:expr) => {{
                if let Some(value) = $key {
                    let val = value.0;
                    let mut prefix = value.1;
                    if !prefix.is_empty() {
                        prefix = context.targets.prefixes(prefix, PrefixFeature::$feature);
                        // 2009 block
                        #[allow(unused)]
                        {
                            if prefix.contains(VendorPrefix::NONE) {
                                // 2009 spec, implemented by webkit and firefox
                                if let Some(targets) = &context.targets.browsers {
                                    let mut prefixes_2009 = VendorPrefix::empty();
                                    if is_flex_2009(*targets) {
                                        prefixes_2009.insert(VendorPrefix::WEBKIT);
                                    }
                                    if prefix.contains(VendorPrefix::MOZ) {
                                        prefixes_2009.insert(VendorPrefix::MOZ);
                                    }
                                    if !prefixes_2009.is_empty() {
                                        ($body_2009)(val.clone(), &prefix, prefixes_2009);
                                    }
                                }
                            }
                        }
                        // 2012 block
                        ($body_2012)(val.clone(), &mut prefix);

                        // Firefox only implemented the 2009 spec prefixed.
                        prefix.remove(VendorPrefix::MOZ);
                        dest.push(Property::$variant((val, prefix)));
                    }
                }
            }};
        }
        // TODO(port): single_property! macro encodes Zig's comptime `prop_2009`/`prop_2012` branches.
        // The Zig version gates the entire 2009 block on `comptime prop_2009 != null`; here the macro
        // arms with `prop_2009 = None` pass a no-op closure, so the `prefix.contains(NONE)` check
        // still runs but has no effect. Phase B should verify this matches behavior exactly.

        single_property!(
            FlexDirection,
            direction.take(),
            prop_2012 = None,
            prop_2009 = None,
            feature = FlexDirection
        );
        single_property!(
            FlexWrap,
            wrap.take(),
            prop_2012 = None,
            prop_2009 = (BoxLines, BoxLines),
            feature = FlexWrap
        );

        if let Some(targets) = &context.targets.browsers {
            if let Some(val) = &grow {
                let g = val.0;
                let prefixes = context
                    .targets
                    .prefixes(VendorPrefix::NONE, PrefixFeature::FlexGrow);
                let mut prefixes_2009 = VendorPrefix::empty();
                if is_flex_2009(*targets) {
                    prefixes_2009.insert(VendorPrefix::WEBKIT);
                }
                if prefixes.contains(VendorPrefix::MOZ) {
                    prefixes_2009.insert(VendorPrefix::MOZ);
                }
                if !prefixes_2009.is_empty() {
                    dest.push(Property::BoxFlex((g, prefixes_2009)));
                }
            }
        }

        if grow.is_some() && shrink.is_some() && basis.is_some() {
            // PORT NOTE: reshaped for borrowck
            let g_val = grow.as_mut().unwrap();
            let s_val = shrink.as_mut().unwrap();
            let b_val = basis.as_mut().unwrap();
            let g = g_val.0;
            let g_prefix: &mut VendorPrefix = &mut g_val.1;
            let s = s_val.0;
            let s_prefix: &mut VendorPrefix = &mut s_val.1;
            let b = b_val.0.clone();
            let b_prefix: &mut VendorPrefix = &mut b_val.1;

            let intersection = g_prefix.intersection(s_prefix.intersection(*b_prefix));
            if !intersection.is_empty() {
                let mut prefix = context.targets.prefixes(intersection, PrefixFeature::Flex);
                // Firefox only implemented the 2009 spec prefixed.
                prefix.remove(VendorPrefix::MOZ);
                dest.push(Property::Flex((
                    Flex {
                        grow: g,
                        shrink: s,
                        basis: b,
                    },
                    prefix,
                )));
                g_prefix.remove(intersection);
                s_prefix.remove(intersection);
                b_prefix.remove(intersection);
            }
        }

        single_property!(
            FlexGrow,
            grow.take(),
            prop_2012 = FlexPositive,
            prop_2009 = None,
            feature = FlexGrow
        );
        single_property!(
            FlexShrink,
            shrink.take(),
            prop_2012 = FlexNegative,
            prop_2009 = None,
            feature = FlexShrink
        );
        single_property!(
            FlexBasis,
            basis.take(),
            prop_2012 = FlexPreferredSize,
            prop_2009 = None,
            feature = FlexBasis
        );
        single_property!(
            Order,
            order.take(),
            prop_2012 = FlexOrder,
            prop_2009 = (BoxOrdinalGroup, BoxOrdinalGroup),
            feature = Order
        );
    }

    fn is_flex_property(property_id: &PropertyId) -> bool {
        matches!(
            property_id,
            PropertyId::FlexDirection(..)
                | PropertyId::BoxOrient(..)
                | PropertyId::BoxDirection(..)
                | PropertyId::FlexWrap(..)
                | PropertyId::BoxLines(..)
                | PropertyId::FlexFlow(..)
                | PropertyId::FlexGrow(..)
                | PropertyId::BoxFlex(..)
                | PropertyId::FlexPositive(..)
                | PropertyId::FlexShrink(..)
                | PropertyId::FlexNegative(..)
                | PropertyId::FlexBasis(..)
                | PropertyId::FlexPreferredSize(..)
                | PropertyId::Flex(..)
                | PropertyId::Order(..)
                | PropertyId::BoxOrdinalGroup(..)
                | PropertyId::FlexOrder(..)
        )
    }
}

// ported from: src/css/properties/flex.zig
