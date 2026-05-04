use crate as css;
use crate::css_values::length::LengthPercentageOrAuto;
use crate::logical::PropertyCategory;
use crate::{DeclarationList, Property, PropertyHandlerContext, PropertyIdTag};
// TODO(port): verify these paths in Phase B — `css.compat.Feature` / `css.Feature`
use crate::compat::Feature;

// ──────────────────────────────────────────────────────────────────────────
// Shorthand value types
// ──────────────────────────────────────────────────────────────────────────
//
// Zig used `css.DefineRectShorthand(@This(), V)` / `css.DefineSizeShorthand(@This(), V)`
// as comptime mixins that inject `parse` + `toCss`. In Rust those become trait
// impls (`RectShorthand` / `SizeShorthand`) that provide default `parse`/`to_css`.
// The trait comes first (PORTING.md §Comptime reflection); a `#[derive]` may
// replace the manual impls in Phase B.
//
// `implementDeepClone` / `implementEql` are field-wise reflection helpers →
// `#[derive(Clone, PartialEq)]`. Thin inherent `deep_clone`/`eql` wrappers are
// kept so cross-file callers (`x.deepClone(...)` → `x.deep_clone()`) keep
// diffing 1:1.
//
// `PropertyFieldMap` (an anonymous struct mapping field-name → PropertyIdTag)
// becomes an associated const slice; consumers that did `@field(map, name)`
// will look up by name. // TODO(port): if consumers need O(1) by-field access,
// switch to per-type associated consts.

/// A value for the [inset](https://drafts.csswg.org/css-logical/#propdef-inset) shorthand property.
#[derive(Clone, PartialEq)]
pub struct Inset {
    pub top: LengthPercentageOrAuto,
    pub right: LengthPercentageOrAuto,
    pub bottom: LengthPercentageOrAuto,
    pub left: LengthPercentageOrAuto,
}

impl Inset {
    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.inset);

    pub const PROPERTY_FIELD_MAP: &'static [(&'static str, PropertyIdTag)] = &[
        ("top", PropertyIdTag::Top),
        ("right", PropertyIdTag::Right),
        ("bottom", PropertyIdTag::Bottom),
        ("left", PropertyIdTag::Left),
    ];

    pub fn deep_clone(&self) -> Self {
        self.clone()
    }
    pub fn eql(&self, rhs: &Self) -> bool {
        self == rhs
    }
}
// `pub const toCss = css_impl.toCss; pub const parse = css_impl.parse;`
// → provided by the RectShorthand trait's default methods.
impl css::RectShorthand for Inset {
    type Value = LengthPercentageOrAuto;
}

/// A value for the [inset-block](https://drafts.csswg.org/css-logical/#propdef-inset-block) shorthand property.
#[derive(Clone, PartialEq)]
pub struct InsetBlock {
    /// The block start value.
    pub block_start: LengthPercentageOrAuto,
    /// The block end value.
    pub block_end: LengthPercentageOrAuto,
}

impl InsetBlock {
    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"inset-block");

    pub const PROPERTY_FIELD_MAP: &'static [(&'static str, PropertyIdTag)] = &[
        ("block_start", PropertyIdTag::InsetBlockStart),
        ("block_end", PropertyIdTag::InsetBlockEnd),
    ];

    pub fn deep_clone(&self) -> Self {
        self.clone()
    }
    pub fn eql(&self, rhs: &Self) -> bool {
        self == rhs
    }
}
impl css::SizeShorthand for InsetBlock {
    type Value = LengthPercentageOrAuto;
}

/// A value for the [inset-inline](https://drafts.csswg.org/css-logical/#propdef-inset-inline) shorthand property.
#[derive(Clone, PartialEq)]
pub struct InsetInline {
    /// The inline start value.
    pub inline_start: LengthPercentageOrAuto,
    /// The inline end value.
    pub inline_end: LengthPercentageOrAuto,
}

impl InsetInline {
    pub const PROPERTY_FIELD_MAP: &'static [(&'static str, PropertyIdTag)] = &[
        ("inline_start", PropertyIdTag::InsetInlineStart),
        ("inline_end", PropertyIdTag::InsetInlineEnd),
    ];

    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"inset-inline");

    pub fn deep_clone(&self) -> Self {
        self.clone()
    }
    pub fn eql(&self, rhs: &Self) -> bool {
        self == rhs
    }
}
impl css::SizeShorthand for InsetInline {
    type Value = LengthPercentageOrAuto;
}

/// A value for the [margin-block](https://drafts.csswg.org/css-logical/#propdef-margin-block) shorthand property.
#[derive(Clone, PartialEq)]
pub struct MarginBlock {
    /// The block start value.
    pub block_start: LengthPercentageOrAuto,
    /// The block end value.
    pub block_end: LengthPercentageOrAuto,
}

impl MarginBlock {
    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"margin-block");

    pub const PROPERTY_FIELD_MAP: &'static [(&'static str, PropertyIdTag)] = &[
        ("block_start", PropertyIdTag::MarginBlockStart),
        ("block_end", PropertyIdTag::MarginBlockEnd),
    ];

    pub fn deep_clone(&self) -> Self {
        self.clone()
    }
    pub fn eql(&self, rhs: &Self) -> bool {
        self == rhs
    }
}
impl css::SizeShorthand for MarginBlock {
    type Value = LengthPercentageOrAuto;
}

/// A value for the [margin-inline](https://drafts.csswg.org/css-logical/#propdef-margin-inline) shorthand property.
#[derive(Clone, PartialEq)]
pub struct MarginInline {
    /// The inline start value.
    pub inline_start: LengthPercentageOrAuto,
    /// The inline end value.
    pub inline_end: LengthPercentageOrAuto,
}

impl MarginInline {
    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"margin-inline");

    pub const PROPERTY_FIELD_MAP: &'static [(&'static str, PropertyIdTag)] = &[
        ("inline_start", PropertyIdTag::MarginInlineStart),
        ("inline_end", PropertyIdTag::MarginInlineEnd),
    ];

    pub fn deep_clone(&self) -> Self {
        self.clone()
    }
    pub fn eql(&self, rhs: &Self) -> bool {
        self == rhs
    }
}
impl css::SizeShorthand for MarginInline {
    type Value = LengthPercentageOrAuto;
}

/// A value for the [margin](https://drafts.csswg.org/css-box-4/#propdef-margin) shorthand property.
#[derive(Clone, PartialEq)]
pub struct Margin {
    pub top: LengthPercentageOrAuto,
    pub right: LengthPercentageOrAuto,
    pub bottom: LengthPercentageOrAuto,
    pub left: LengthPercentageOrAuto,
}

impl Margin {
    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.margin);

    pub const PROPERTY_FIELD_MAP: &'static [(&'static str, PropertyIdTag)] = &[
        ("top", PropertyIdTag::MarginTop),
        ("right", PropertyIdTag::MarginRight),
        ("bottom", PropertyIdTag::MarginBottom),
        ("left", PropertyIdTag::MarginLeft),
    ];

    pub fn deep_clone(&self) -> Self {
        self.clone()
    }
    pub fn eql(&self, rhs: &Self) -> bool {
        self == rhs
    }
}
impl css::RectShorthand for Margin {
    type Value = LengthPercentageOrAuto;
}

/// A value for the [padding-block](https://drafts.csswg.org/css-logical/#propdef-padding-block) shorthand property.
#[derive(Clone, PartialEq)]
pub struct PaddingBlock {
    /// The block start value.
    pub block_start: LengthPercentageOrAuto,
    /// The block end value.
    pub block_end: LengthPercentageOrAuto,
}

impl PaddingBlock {
    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"padding-block");

    pub const PROPERTY_FIELD_MAP: &'static [(&'static str, PropertyIdTag)] = &[
        ("block_start", PropertyIdTag::PaddingBlockStart),
        ("block_end", PropertyIdTag::PaddingBlockEnd),
    ];

    pub fn deep_clone(&self) -> Self {
        self.clone()
    }
    pub fn eql(&self, rhs: &Self) -> bool {
        self == rhs
    }
}
impl css::SizeShorthand for PaddingBlock {
    type Value = LengthPercentageOrAuto;
}

/// A value for the [padding-inline](https://drafts.csswg.org/css-logical/#propdef-padding-inline) shorthand property.
#[derive(Clone, PartialEq)]
pub struct PaddingInline {
    /// The inline start value.
    pub inline_start: LengthPercentageOrAuto,
    /// The inline end value.
    pub inline_end: LengthPercentageOrAuto,
}

impl PaddingInline {
    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"padding-inline");

    pub const PROPERTY_FIELD_MAP: &'static [(&'static str, PropertyIdTag)] = &[
        ("inline_start", PropertyIdTag::PaddingInlineStart),
        ("inline_end", PropertyIdTag::PaddingInlineEnd),
    ];

    pub fn deep_clone(&self) -> Self {
        self.clone()
    }
    pub fn eql(&self, rhs: &Self) -> bool {
        self == rhs
    }
}
impl css::SizeShorthand for PaddingInline {
    type Value = LengthPercentageOrAuto;
}

/// A value for the [padding](https://drafts.csswg.org/css-box-4/#propdef-padding) shorthand property.
#[derive(Clone, PartialEq)]
pub struct Padding {
    pub top: LengthPercentageOrAuto,
    pub right: LengthPercentageOrAuto,
    pub bottom: LengthPercentageOrAuto,
    pub left: LengthPercentageOrAuto,
}

impl Padding {
    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.padding);

    pub const PROPERTY_FIELD_MAP: &'static [(&'static str, PropertyIdTag)] = &[
        ("top", PropertyIdTag::PaddingTop),
        ("right", PropertyIdTag::PaddingRight),
        ("bottom", PropertyIdTag::PaddingBottom),
        ("left", PropertyIdTag::PaddingLeft),
    ];

    pub fn deep_clone(&self) -> Self {
        self.clone()
    }
    pub fn eql(&self, rhs: &Self) -> bool {
        self == rhs
    }
}
impl css::RectShorthand for Padding {
    type Value = LengthPercentageOrAuto;
}

/// A value for the [scroll-margin-block](https://drafts.csswg.org/css-scroll-snap/#propdef-scroll-margin-block) shorthand property.
#[derive(Clone, PartialEq)]
pub struct ScrollMarginBlock {
    /// The block start value.
    pub block_start: LengthPercentageOrAuto,
    /// The block end value.
    pub block_end: LengthPercentageOrAuto,
}

impl ScrollMarginBlock {
    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"scroll-margin-block");

    pub const PROPERTY_FIELD_MAP: &'static [(&'static str, PropertyIdTag)] = &[
        ("block_start", PropertyIdTag::ScrollMarginBlockStart),
        ("block_end", PropertyIdTag::ScrollMarginBlockEnd),
    ];

    pub fn deep_clone(&self) -> Self {
        self.clone()
    }
    pub fn eql(&self, rhs: &Self) -> bool {
        self == rhs
    }
}
impl css::SizeShorthand for ScrollMarginBlock {
    type Value = LengthPercentageOrAuto;
}

/// A value for the [scroll-margin-inline](https://drafts.csswg.org/css-scroll-snap/#propdef-scroll-margin-inline) shorthand property.
#[derive(Clone, PartialEq)]
pub struct ScrollMarginInline {
    /// The inline start value.
    pub inline_start: LengthPercentageOrAuto,
    /// The inline end value.
    pub inline_end: LengthPercentageOrAuto,
}

impl ScrollMarginInline {
    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"scroll-margin-inline");

    pub const PROPERTY_FIELD_MAP: &'static [(&'static str, PropertyIdTag)] = &[
        ("inline_start", PropertyIdTag::ScrollMarginInlineStart),
        ("inline_end", PropertyIdTag::ScrollMarginInlineEnd),
    ];

    pub fn deep_clone(&self) -> Self {
        self.clone()
    }
    pub fn eql(&self, rhs: &Self) -> bool {
        self == rhs
    }
}
impl css::SizeShorthand for ScrollMarginInline {
    type Value = LengthPercentageOrAuto;
}

/// A value for the [scroll-margin](https://drafts.csswg.org/css-scroll-snap/#scroll-margin) shorthand property.
#[derive(Clone, PartialEq)]
pub struct ScrollMargin {
    pub top: LengthPercentageOrAuto,
    pub right: LengthPercentageOrAuto,
    pub bottom: LengthPercentageOrAuto,
    pub left: LengthPercentageOrAuto,
}

impl ScrollMargin {
    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"scroll-margin");

    pub const PROPERTY_FIELD_MAP: &'static [(&'static str, PropertyIdTag)] = &[
        ("top", PropertyIdTag::ScrollMarginTop),
        ("right", PropertyIdTag::ScrollMarginRight),
        ("bottom", PropertyIdTag::ScrollMarginBottom),
        ("left", PropertyIdTag::ScrollMarginLeft),
    ];

    pub fn deep_clone(&self) -> Self {
        self.clone()
    }
    pub fn eql(&self, rhs: &Self) -> bool {
        self == rhs
    }
}
impl css::RectShorthand for ScrollMargin {
    type Value = LengthPercentageOrAuto;
}

/// A value for the [scroll-padding-block](https://drafts.csswg.org/css-scroll-snap/#propdef-scroll-padding-block) shorthand property.
#[derive(Clone, PartialEq)]
pub struct ScrollPaddingBlock {
    /// The block start value.
    pub block_start: LengthPercentageOrAuto,
    /// The block end value.
    pub block_end: LengthPercentageOrAuto,
}

impl ScrollPaddingBlock {
    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"scroll-padding-block");

    pub const PROPERTY_FIELD_MAP: &'static [(&'static str, PropertyIdTag)] = &[
        ("block_start", PropertyIdTag::ScrollPaddingBlockStart),
        ("block_end", PropertyIdTag::ScrollPaddingBlockEnd),
    ];

    pub fn deep_clone(&self) -> Self {
        self.clone()
    }
    pub fn eql(&self, rhs: &Self) -> bool {
        self == rhs
    }
}
impl css::SizeShorthand for ScrollPaddingBlock {
    type Value = LengthPercentageOrAuto;
}

/// A value for the [scroll-padding-inline](https://drafts.csswg.org/css-scroll-snap/#propdef-scroll-padding-inline) shorthand property.
#[derive(Clone, PartialEq)]
pub struct ScrollPaddingInline {
    /// The inline start value.
    pub inline_start: LengthPercentageOrAuto,
    /// The inline end value.
    pub inline_end: LengthPercentageOrAuto,
}

impl ScrollPaddingInline {
    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"scroll-padding-inline");

    pub const PROPERTY_FIELD_MAP: &'static [(&'static str, PropertyIdTag)] = &[
        ("inline_start", PropertyIdTag::ScrollPaddingInlineStart),
        ("inline_end", PropertyIdTag::ScrollPaddingInlineEnd),
    ];

    pub fn deep_clone(&self) -> Self {
        self.clone()
    }
    pub fn eql(&self, rhs: &Self) -> bool {
        self == rhs
    }
}
impl css::SizeShorthand for ScrollPaddingInline {
    type Value = LengthPercentageOrAuto;
}

/// A value for the [scroll-padding](https://drafts.csswg.org/css-scroll-snap/#scroll-padding) shorthand property.
#[derive(Clone, PartialEq)]
pub struct ScrollPadding {
    pub top: LengthPercentageOrAuto,
    pub right: LengthPercentageOrAuto,
    pub bottom: LengthPercentageOrAuto,
    pub left: LengthPercentageOrAuto,
}

impl ScrollPadding {
    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"scroll-padding");

    pub const PROPERTY_FIELD_MAP: &'static [(&'static str, PropertyIdTag)] = &[
        ("top", PropertyIdTag::ScrollPaddingTop),
        ("right", PropertyIdTag::ScrollPaddingRight),
        ("bottom", PropertyIdTag::ScrollPaddingBottom),
        ("left", PropertyIdTag::ScrollPaddingLeft),
    ];

    pub fn deep_clone(&self) -> Self {
        self.clone()
    }
    pub fn eql(&self, rhs: &Self) -> bool {
        self == rhs
    }
}
impl css::RectShorthand for ScrollPadding {
    type Value = LengthPercentageOrAuto;
}

// ──────────────────────────────────────────────────────────────────────────
// Handlers
// ──────────────────────────────────────────────────────────────────────────

pub type MarginHandler = SizeHandler<MarginSpec>;
pub type PaddingHandler = SizeHandler<PaddingSpec>;
pub type ScrollMarginHandler = SizeHandler<ScrollMarginSpec>;
pub type InsetHandler = SizeHandler<InsetSpec>;

// ──────────────────────────────────────────────────────────────────────────
// NewSizeHandler — Zig `fn(comptime ...) type { return struct { ... } }`
// ──────────────────────────────────────────────────────────────────────────
//
// The Zig generator took 11 `comptime PropertyIdTag` parameters, a
// `comptime PropertyCategory`, and an optional `{feature, shorthand_feature}`
// pair, and used `@field` / `@tagName` / `@unionInit` to project in/out of
// the `Property` tagged union by tag name at compile time.
//
// Rust cannot reflect on enum variants by `PropertyIdTag` value, so the
// per-variant projection is moved into a `SizeHandlerSpec` trait. The
// generic body (`handle_property` / `flush` / helpers) is preserved 1:1 and
// calls through `S::*`. Each concrete handler is a zero-sized marker type
// implementing the spec.
//
// TODO(port): a `macro_rules! size_handler_spec!` could generate the four
// `SizeHandlerSpec` impls from the same 13-argument table the Zig used,
// eliminating the per-spec extract/construct boilerplate. Left explicit for
// Phase-A reviewability.

/// Selector for the four physical slots on `SizeHandler` (Zig used a
/// `comptime field: []const u8` and `@field(this, field)`).
#[derive(Copy, Clone)]
enum PhysicalSlot {
    Top,
    Bottom,
    Left,
    Right,
}

/// Selector for the four logical slots on `SizeHandler`.
#[derive(Copy, Clone)]
enum LogicalSlot {
    BlockStart,
    BlockEnd,
    InlineStart,
    InlineEnd,
}

/// Compile-time configuration for one `SizeHandler` instantiation.
///
/// Replaces the 13 `comptime` parameters of Zig's `NewSizeHandler` and the
/// `@field(property, @tagName(X_prop))` / `@unionInit(Property, @tagName(X_prop), v)`
/// reflection it performed.
pub trait SizeHandlerSpec {
    // ---- comptime tag parameters ----
    const TOP: PropertyIdTag;
    const BOTTOM: PropertyIdTag;
    const LEFT: PropertyIdTag;
    const RIGHT: PropertyIdTag;
    const BLOCK_START: PropertyIdTag;
    const BLOCK_END: PropertyIdTag;
    const INLINE_START: PropertyIdTag;
    const INLINE_END: PropertyIdTag;
    const SHORTHAND: PropertyIdTag;
    const BLOCK_SHORTHAND: PropertyIdTag;
    const INLINE_SHORTHAND: PropertyIdTag;
    const SHORTHAND_CATEGORY: PropertyCategory;
    /// `shorthand_extra.?.feature` — `None` ⇔ Zig passed `null`.
    const FEATURE: Option<Feature>;
    /// `shorthand_extra.?.shorthand_feature`.
    const SHORTHAND_FEATURE: Option<Feature>;

    // ---- value-type bindings (Zig: `X_prop.valueType()`) ----
    // In every instantiation in this file the longhand value type is
    // `LengthPercentageOrAuto`, so the generic body below uses that
    // concretely. If a future spec needs a different `valueType()`, lift it
    // to an associated type here.

    /// Zig: `shorthand_prop.valueType()` (the 4-field rect struct).
    type Shorthand;
    /// Zig: `block_shorthand.valueType()` (the 2-field block struct).
    type BlockShorthand;
    /// Zig: `inline_shorthand.valueType()` (the 2-field inline struct).
    type InlineShorthand;

    // ---- @field / @unionInit replacements ----
    // Each pair is the Rust spelling of:
    //   `@field(property, @tagName(X_prop))`       → extract_x
    //   `@unionInit(Property, @tagName(X_prop), v)` → make_x
    // TODO(port): these are pure mechanical pattern-matches over `Property`;
    // generate via macro in Phase B.

    fn extract_top(p: &Property) -> &LengthPercentageOrAuto;
    fn extract_bottom(p: &Property) -> &LengthPercentageOrAuto;
    fn extract_left(p: &Property) -> &LengthPercentageOrAuto;
    fn extract_right(p: &Property) -> &LengthPercentageOrAuto;
    fn extract_block_start(p: &Property) -> &LengthPercentageOrAuto;
    fn extract_block_end(p: &Property) -> &LengthPercentageOrAuto;
    fn extract_inline_start(p: &Property) -> &LengthPercentageOrAuto;
    fn extract_inline_end(p: &Property) -> &LengthPercentageOrAuto;
    fn extract_shorthand(p: &Property) -> &Self::Shorthand;
    fn extract_block_shorthand(p: &Property) -> &Self::BlockShorthand;
    fn extract_inline_shorthand(p: &Property) -> &Self::InlineShorthand;

    fn make_top(v: LengthPercentageOrAuto) -> Property;
    fn make_bottom(v: LengthPercentageOrAuto) -> Property;
    fn make_left(v: LengthPercentageOrAuto) -> Property;
    fn make_right(v: LengthPercentageOrAuto) -> Property;
    fn make_block_start(v: LengthPercentageOrAuto) -> Property;
    fn make_block_end(v: LengthPercentageOrAuto) -> Property;
    fn make_inline_start(v: LengthPercentageOrAuto) -> Property;
    fn make_inline_end(v: LengthPercentageOrAuto) -> Property;
    fn make_shorthand(
        top: LengthPercentageOrAuto,
        bottom: LengthPercentageOrAuto,
        left: LengthPercentageOrAuto,
        right: LengthPercentageOrAuto,
    ) -> Property;
    fn make_block_shorthand(
        block_start: LengthPercentageOrAuto,
        block_end: LengthPercentageOrAuto,
    ) -> Property;
    fn make_inline_shorthand(
        inline_start: LengthPercentageOrAuto,
        inline_end: LengthPercentageOrAuto,
    ) -> Property;

    // Field accessors on the shorthand value structs (Zig: `val.block_start` etc.).
    fn shorthand_top(v: &Self::Shorthand) -> &LengthPercentageOrAuto;
    fn shorthand_right(v: &Self::Shorthand) -> &LengthPercentageOrAuto;
    fn shorthand_bottom(v: &Self::Shorthand) -> &LengthPercentageOrAuto;
    fn shorthand_left(v: &Self::Shorthand) -> &LengthPercentageOrAuto;
    fn block_shorthand_start(v: &Self::BlockShorthand) -> &LengthPercentageOrAuto;
    fn block_shorthand_end(v: &Self::BlockShorthand) -> &LengthPercentageOrAuto;
    fn inline_shorthand_start(v: &Self::InlineShorthand) -> &LengthPercentageOrAuto;
    fn inline_shorthand_end(v: &Self::InlineShorthand) -> &LengthPercentageOrAuto;
}

/// Generic margin/padding/inset/scroll-* handler.
///
/// Zig: the anonymous `return struct { ... }` inside `NewSizeHandler`.
pub struct SizeHandler<S: SizeHandlerSpec> {
    pub top: Option<LengthPercentageOrAuto>,
    pub bottom: Option<LengthPercentageOrAuto>,
    pub left: Option<LengthPercentageOrAuto>,
    pub right: Option<LengthPercentageOrAuto>,
    pub block_start: Option<Property>,
    pub block_end: Option<Property>,
    pub inline_start: Option<Property>,
    pub inline_end: Option<Property>,
    pub has_any: bool,
    pub category: PropertyCategory,
    _spec: core::marker::PhantomData<S>,
}

impl<S: SizeHandlerSpec> Default for SizeHandler<S> {
    fn default() -> Self {
        Self {
            top: None,
            bottom: None,
            left: None,
            right: None,
            block_start: None,
            block_end: None,
            inline_start: None,
            inline_end: None,
            has_any: false,
            category: PropertyCategory::default(),
            _spec: core::marker::PhantomData,
        }
    }
}

impl<S: SizeHandlerSpec> SizeHandler<S> {
    // ---- @field(this, field) replacements ----
    fn physical_slot(&mut self, slot: PhysicalSlot) -> &mut Option<LengthPercentageOrAuto> {
        match slot {
            PhysicalSlot::Top => &mut self.top,
            PhysicalSlot::Bottom => &mut self.bottom,
            PhysicalSlot::Left => &mut self.left,
            PhysicalSlot::Right => &mut self.right,
        }
    }
    fn physical_slot_is_some(&self, slot: PhysicalSlot) -> bool {
        match slot {
            PhysicalSlot::Top => self.top.is_some(),
            PhysicalSlot::Bottom => self.bottom.is_some(),
            PhysicalSlot::Left => self.left.is_some(),
            PhysicalSlot::Right => self.right.is_some(),
        }
    }
    fn logical_slot(&mut self, slot: LogicalSlot) -> &mut Option<Property> {
        match slot {
            LogicalSlot::BlockStart => &mut self.block_start,
            LogicalSlot::BlockEnd => &mut self.block_end,
            LogicalSlot::InlineStart => &mut self.inline_start,
            LogicalSlot::InlineEnd => &mut self.inline_end,
        }
    }
    fn logical_slot_is_some(&self, slot: LogicalSlot) -> bool {
        match slot {
            LogicalSlot::BlockStart => self.block_start.is_some(),
            LogicalSlot::BlockEnd => self.block_end.is_some(),
            LogicalSlot::InlineStart => self.inline_start.is_some(),
            LogicalSlot::InlineEnd => self.inline_end.is_some(),
        }
    }

    pub fn handle_property(
        &mut self,
        property: &Property,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) -> bool {
        // Zig: `switch (@as(PropertyIdTag, property.*))`
        let tag = property.id();
        if tag == S::TOP {
            self.property_helper(
                PhysicalSlot::Top,
                S::extract_top(property),
                PropertyCategory::Physical,
                dest,
                context,
            );
        } else if tag == S::BOTTOM {
            self.property_helper(
                PhysicalSlot::Bottom,
                S::extract_bottom(property),
                PropertyCategory::Physical,
                dest,
                context,
            );
        } else if tag == S::LEFT {
            self.property_helper(
                PhysicalSlot::Left,
                S::extract_left(property),
                PropertyCategory::Physical,
                dest,
                context,
            );
        } else if tag == S::RIGHT {
            self.property_helper(
                PhysicalSlot::Right,
                S::extract_right(property),
                PropertyCategory::Physical,
                dest,
                context,
            );
        } else if tag == S::BLOCK_START {
            self.flush_helper_logical(
                LogicalSlot::BlockStart,
                S::extract_block_start(property),
                PropertyCategory::Logical,
                dest,
                context,
            );
            self.logical_property_helper(
                LogicalSlot::BlockStart,
                property.deep_clone(),
                dest,
                context,
            );
        } else if tag == S::BLOCK_END {
            self.flush_helper_logical(
                LogicalSlot::BlockEnd,
                S::extract_block_end(property),
                PropertyCategory::Logical,
                dest,
                context,
            );
            self.logical_property_helper(LogicalSlot::BlockEnd, property.deep_clone(), dest, context);
        } else if tag == S::INLINE_START {
            self.flush_helper_logical(
                LogicalSlot::InlineStart,
                S::extract_inline_start(property),
                PropertyCategory::Logical,
                dest,
                context,
            );
            self.logical_property_helper(
                LogicalSlot::InlineStart,
                property.deep_clone(),
                dest,
                context,
            );
        } else if tag == S::INLINE_END {
            self.flush_helper_logical(
                LogicalSlot::InlineEnd,
                S::extract_inline_end(property),
                PropertyCategory::Logical,
                dest,
                context,
            );
            self.logical_property_helper(
                LogicalSlot::InlineEnd,
                property.deep_clone(),
                dest,
                context,
            );
        } else if tag == S::BLOCK_SHORTHAND {
            let val = S::extract_block_shorthand(property);
            self.flush_helper_logical(
                LogicalSlot::BlockStart,
                S::block_shorthand_start(val),
                PropertyCategory::Logical,
                dest,
                context,
            );
            self.flush_helper_logical(
                LogicalSlot::BlockEnd,
                S::block_shorthand_end(val),
                PropertyCategory::Logical,
                dest,
                context,
            );
            self.logical_property_helper(
                LogicalSlot::BlockStart,
                S::make_block_start(S::block_shorthand_start(val).deep_clone()),
                dest,
                context,
            );
            self.logical_property_helper(
                LogicalSlot::BlockEnd,
                S::make_block_end(S::block_shorthand_end(val).deep_clone()),
                dest,
                context,
            );
        } else if tag == S::INLINE_SHORTHAND {
            let val = S::extract_inline_shorthand(property);
            self.flush_helper_logical(
                LogicalSlot::InlineStart,
                S::inline_shorthand_start(val),
                PropertyCategory::Logical,
                dest,
                context,
            );
            self.flush_helper_logical(
                LogicalSlot::InlineEnd,
                S::inline_shorthand_end(val),
                PropertyCategory::Logical,
                dest,
                context,
            );
            self.logical_property_helper(
                LogicalSlot::InlineStart,
                S::make_inline_start(S::inline_shorthand_start(val).deep_clone()),
                dest,
                context,
            );
            self.logical_property_helper(
                LogicalSlot::InlineEnd,
                S::make_inline_end(S::inline_shorthand_end(val).deep_clone()),
                dest,
                context,
            );
        } else if tag == S::SHORTHAND {
            let val = S::extract_shorthand(property);
            self.flush_helper_physical(
                PhysicalSlot::Top,
                S::shorthand_top(val),
                S::SHORTHAND_CATEGORY,
                dest,
                context,
            );
            self.flush_helper_physical(
                PhysicalSlot::Right,
                S::shorthand_right(val),
                S::SHORTHAND_CATEGORY,
                dest,
                context,
            );
            self.flush_helper_physical(
                PhysicalSlot::Bottom,
                S::shorthand_bottom(val),
                S::SHORTHAND_CATEGORY,
                dest,
                context,
            );
            self.flush_helper_physical(
                PhysicalSlot::Left,
                S::shorthand_left(val),
                S::SHORTHAND_CATEGORY,
                dest,
                context,
            );
            self.top = Some(S::shorthand_top(val).deep_clone());
            self.right = Some(S::shorthand_right(val).deep_clone());
            self.bottom = Some(S::shorthand_bottom(val).deep_clone());
            self.left = Some(S::shorthand_left(val).deep_clone());
            self.block_start = None;
            self.block_end = None;
            self.inline_start = None;
            self.inline_end = None;
            self.has_any = true;
        } else if tag == PropertyIdTag::Unparsed {
            // Zig: `property.unparsed.property_id`
            // TODO(port): confirm `Property::Unparsed` payload accessor name.
            let unparsed = match property {
                Property::Unparsed(u) => u,
                _ => unreachable!(),
            };
            let id = unparsed.property_id;
            if id == S::TOP
                || id == S::BOTTOM
                || id == S::LEFT
                || id == S::RIGHT
                || id == S::BLOCK_START
                || id == S::BLOCK_END
                || id == S::INLINE_START
                || id == S::INLINE_END
                || id == S::BLOCK_SHORTHAND
                || id == S::INLINE_SHORTHAND
                || id == S::SHORTHAND
            {
                // Even if we weren't able to parse the value (e.g. due to var() references),
                // we can still add vendor prefixes to the property itself.
                if id == S::BLOCK_START {
                    self.logical_property_helper(
                        LogicalSlot::BlockStart,
                        property.deep_clone(),
                        dest,
                        context,
                    );
                } else if id == S::BLOCK_END {
                    self.logical_property_helper(
                        LogicalSlot::BlockEnd,
                        property.deep_clone(),
                        dest,
                        context,
                    );
                } else if id == S::INLINE_START {
                    self.logical_property_helper(
                        LogicalSlot::InlineStart,
                        property.deep_clone(),
                        dest,
                        context,
                    );
                } else if id == S::INLINE_END {
                    self.logical_property_helper(
                        LogicalSlot::InlineEnd,
                        property.deep_clone(),
                        dest,
                        context,
                    );
                } else {
                    self.flush(dest, context);
                    dest.push(property.deep_clone());
                }
            } else {
                return false;
            }
        } else {
            return false;
        }

        true
    }

    pub fn finalize(&mut self, dest: &mut DeclarationList, context: &mut PropertyHandlerContext) {
        self.flush(dest, context);
    }

    // PORT NOTE: reshaped — Zig's single `flushHelper` (generic over `comptime field: []const u8`
    // via `@field(this, field)`) is split into `flush_helper_physical` + `flush_helper_logical`
    // because the physical slots hold `Option<LengthPercentageOrAuto>` and the logical slots hold
    // `Option<Property>`; Rust cannot express `@field` over heterogeneous Option payloads generically.

    /// Zig `flushHelper` for the four physical slots (`top`/`bottom`/`left`/`right`).
    fn flush_helper_physical(
        &mut self,
        field: PhysicalSlot,
        val: &LengthPercentageOrAuto,
        category: PropertyCategory,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) {
        // PERF(port): `category` was comptime monomorphization — profile in Phase B
        // If the category changes betweet logical and physical,
        // or if the value contains syntax that isn't supported across all targets,
        // preserve the previous value as a fallback.
        if category != self.category
            || (self.physical_slot_is_some(field)
                && context.targets.browsers.is_some()
                && !val.is_compatible(context.targets.browsers.as_ref().unwrap()))
        {
            self.flush(dest, context);
        }
    }

    /// Zig `flushHelper` for the four logical slots (`block_start`/.../`inline_end`).
    fn flush_helper_logical(
        &mut self,
        field: LogicalSlot,
        val: &LengthPercentageOrAuto,
        category: PropertyCategory,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) {
        // PERF(port): `category` was comptime monomorphization — profile in Phase B
        // If the category changes betweet logical and physical,
        // or if the value contains syntax that isn't supported across all targets,
        // preserve the previous value as a fallback.
        if category != self.category
            || (self.logical_slot_is_some(field)
                && context.targets.browsers.is_some()
                && !val.is_compatible(context.targets.browsers.as_ref().unwrap()))
        {
            self.flush(dest, context);
        }
    }

    fn property_helper(
        &mut self,
        field: PhysicalSlot,
        val: &LengthPercentageOrAuto,
        category: PropertyCategory,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) {
        // PERF(port): `category` was comptime monomorphization — profile in Phase B
        self.flush_helper_physical(field, val, category, dest, context);
        *self.physical_slot(field) = Some(val.deep_clone());
        self.category = category;
        self.has_any = true;
    }

    fn logical_property_helper(
        &mut self,
        field: LogicalSlot,
        val: Property,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) {
        // Assume unparsed properties might contain unsupported syntax that we must preserve as a fallback.
        if self.category != PropertyCategory::Logical
            || (self.logical_slot_is_some(field) && matches!(val, Property::Unparsed(_)))
        {
            self.flush(dest, context);
        }

        // Zig: `if (@field(this, field)) |*p| p.deinit(context.allocator);`
        // Drop handles deinit; assigning over the Option drops the old value.
        *self.logical_slot(field) = Some(val);
        self.category = PropertyCategory::Logical;
        self.has_any = true;
    }

    fn flush(&mut self, dest: &mut DeclarationList, context: &mut PropertyHandlerContext) {
        if !self.has_any {
            return;
        }

        self.has_any = false;

        let top = self.top.take();
        let bottom = self.bottom.take();
        let left = self.left.take();
        let right = self.right.take();
        let logical_supported = match S::FEATURE {
            Some(feature) => !context.should_compile_logical(feature),
            None => true,
        };

        if (S::SHORTHAND_CATEGORY != PropertyCategory::Logical || logical_supported)
            && top.is_some()
            && bottom.is_some()
            && left.is_some()
            && right.is_some()
        {
            dest.push(S::make_shorthand(
                top.unwrap(),
                bottom.unwrap(),
                left.unwrap(),
                right.unwrap(),
            ));
        } else {
            if let Some(t) = top {
                dest.push(S::make_top(t));
            }
            if let Some(b) = bottom {
                dest.push(S::make_bottom(b));
            }
            if let Some(b) = left {
                dest.push(S::make_left(b));
            }
            if let Some(b) = right {
                dest.push(S::make_right(b));
            }
        }

        let mut block_start = self.block_start.take();
        let mut block_end = self.block_end.take();
        let mut inline_start = self.inline_start.take();
        let mut inline_end = self.inline_end.take();

        if logical_supported {
            Self::logical_side_helper(
                &mut block_start,
                &mut block_end,
                LogicalSidePair::Block,
                logical_supported,
                dest,
                context,
            );
        } else {
            Self::prop(
                &mut block_start,
                S::BLOCK_START,
                S::extract_block_start,
                S::make_top,
                S::TOP,
                dest,
                context,
            );
            Self::prop(
                &mut block_end,
                S::BLOCK_END,
                S::extract_block_end,
                S::make_bottom,
                S::BOTTOM,
                dest,
                context,
            );
        }

        if logical_supported {
            Self::logical_side_helper(
                &mut inline_start,
                &mut inline_end,
                LogicalSidePair::Inline,
                logical_supported,
                dest,
                context,
            );
        } else if inline_start.is_some() || inline_end.is_some() {
            let start_matches = inline_start
                .as_ref()
                .map(|p| p.id() == S::INLINE_START)
                .unwrap_or(false);
            let end_matches = inline_end
                .as_ref()
                .map(|p| p.id() == S::INLINE_END)
                .unwrap_or(false);
            let values_equal = if start_matches && end_matches {
                S::extract_inline_start(inline_start.as_ref().unwrap())
                    .eql(S::extract_inline_end(inline_end.as_ref().unwrap()))
            } else {
                false
            };

            if start_matches && end_matches && values_equal {
                Self::prop(
                    &mut inline_start,
                    S::INLINE_START,
                    S::extract_inline_start,
                    S::make_left,
                    S::LEFT,
                    dest,
                    context,
                );
                Self::prop(
                    &mut inline_end,
                    S::INLINE_END,
                    S::extract_inline_end,
                    S::make_right,
                    S::RIGHT,
                    dest,
                    context,
                );
            } else {
                Self::logical_prop_helper(
                    &mut inline_start,
                    S::INLINE_START,
                    S::extract_inline_start,
                    S::make_left,
                    S::LEFT,
                    S::make_right,
                    S::RIGHT,
                    dest,
                    context,
                );
                Self::logical_prop_helper(
                    &mut inline_end,
                    S::INLINE_END,
                    S::extract_inline_end,
                    S::make_right,
                    S::RIGHT,
                    S::make_left,
                    S::LEFT,
                    dest,
                    context,
                );
            }
        }
    }

    #[inline]
    #[allow(clippy::too_many_arguments)]
    fn logical_prop_helper(
        val: &mut Option<Property>,
        logical: PropertyIdTag,
        extract_logical: fn(&Property) -> &LengthPercentageOrAuto,
        make_ltr: fn(LengthPercentageOrAuto) -> Property,
        ltr: PropertyIdTag,
        make_rtl: fn(LengthPercentageOrAuto) -> Property,
        rtl: PropertyIdTag,
        _dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) {
        // _ = this; // autofix
        // _ = dest; // autofix
        if let Some(v_) = val.as_ref() {
            if v_.id() == logical {
                let v = extract_logical(v_);
                context.add_logical_rule(make_ltr(v.deep_clone()), make_rtl(v.deep_clone()));
            } else if let Property::Unparsed(v) = v_ {
                context.add_logical_rule(
                    Property::Unparsed(v.with_property_id(ltr)),
                    Property::Unparsed(v.with_property_id(rtl)),
                );
            }
        }
    }

    #[inline]
    fn logical_side_helper(
        start: &mut Option<Property>,
        end: &mut Option<Property>,
        pair: LogicalSidePair,
        logical_supported: bool,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) {
        // _ = this; // autofix
        let shorthand_supported = logical_supported
            && match S::SHORTHAND_FEATURE {
                Some(f) => !context.should_compile_logical(f),
                None => true,
            };

        let (start_prop, end_prop) = match pair {
            LogicalSidePair::Block => (S::BLOCK_START, S::BLOCK_END),
            LogicalSidePair::Inline => (S::INLINE_START, S::INLINE_END),
        };

        if start.as_ref().map(|p| p.id() == start_prop).unwrap_or(false)
            && end.as_ref().map(|p| p.id() == end_prop).unwrap_or(false)
            && shorthand_supported
        {
            // Zig built `value: ValueType` field-by-field then `@unionInit`.
            // The Zig also `@compileError`ed if the value type had >2 fields;
            // that invariant is upheld structurally by `make_*_shorthand`.
            let start_v = match pair {
                LogicalSidePair::Block => {
                    S::extract_block_start(start.as_ref().unwrap()).deep_clone()
                }
                LogicalSidePair::Inline => {
                    S::extract_inline_start(start.as_ref().unwrap()).deep_clone()
                }
            };
            let end_v = match pair {
                LogicalSidePair::Block => S::extract_block_end(end.as_ref().unwrap()).deep_clone(),
                LogicalSidePair::Inline => {
                    S::extract_inline_end(end.as_ref().unwrap()).deep_clone()
                }
            };
            let prop = match pair {
                LogicalSidePair::Block => S::make_block_shorthand(start_v, end_v),
                LogicalSidePair::Inline => S::make_inline_shorthand(start_v, end_v),
            };
            dest.push(prop);
        } else {
            if let Some(s) = start.take() {
                dest.push(s);
            }
            if let Some(e) = end.take() {
                dest.push(e);
            }
        }
    }

    #[inline]
    fn prop(
        val: &mut Option<Property>,
        logical: PropertyIdTag,
        extract_logical: fn(&Property) -> &LengthPercentageOrAuto,
        make_physical: fn(LengthPercentageOrAuto) -> Property,
        physical: PropertyIdTag,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) {
        // _ = this; // autofix
        let _ = context;
        if let Some(v) = val.as_ref() {
            if v.id() == logical {
                // Zig moved the payload (`@field(v, @tagName(logical))`) by value.
                // PORT NOTE: reshaped for borrowck — clone instead of moving out
                // of `&Property`; `LengthPercentageOrAuto` is small.
                dest.push(make_physical(extract_logical(v).deep_clone()));
            } else if let Property::Unparsed(u) = v {
                dest.push(Property::Unparsed(u.with_property_id(physical)));
            }
        }
    }
}

#[derive(Copy, Clone)]
enum LogicalSidePair {
    Block,
    Inline,
}

// ──────────────────────────────────────────────────────────────────────────
// Spec instantiations
// ──────────────────────────────────────────────────────────────────────────
//
// TODO(port): the extract_*/make_*/shorthand_* bodies below are pure
// `match property { Property::Variant(v) => v, _ => unreachable!() }` /
// `Property::Variant(v)` boilerplate. They are stubbed with `todo!()` here so
// the *generic* logic above can be reviewed against the Zig 1:1; Phase B
// should generate them with a `size_handler_spec!` macro keyed on the same
// 13-argument table the Zig `NewSizeHandler(...)` calls used.

macro_rules! stub_spec_projections {
    () => {
        fn extract_top(_p: &Property) -> &LengthPercentageOrAuto { todo!("TODO(port): @field projection") }
        fn extract_bottom(_p: &Property) -> &LengthPercentageOrAuto { todo!("TODO(port): @field projection") }
        fn extract_left(_p: &Property) -> &LengthPercentageOrAuto { todo!("TODO(port): @field projection") }
        fn extract_right(_p: &Property) -> &LengthPercentageOrAuto { todo!("TODO(port): @field projection") }
        fn extract_block_start(_p: &Property) -> &LengthPercentageOrAuto { todo!("TODO(port): @field projection") }
        fn extract_block_end(_p: &Property) -> &LengthPercentageOrAuto { todo!("TODO(port): @field projection") }
        fn extract_inline_start(_p: &Property) -> &LengthPercentageOrAuto { todo!("TODO(port): @field projection") }
        fn extract_inline_end(_p: &Property) -> &LengthPercentageOrAuto { todo!("TODO(port): @field projection") }
        fn extract_shorthand(_p: &Property) -> &Self::Shorthand { todo!("TODO(port): @field projection") }
        fn extract_block_shorthand(_p: &Property) -> &Self::BlockShorthand { todo!("TODO(port): @field projection") }
        fn extract_inline_shorthand(_p: &Property) -> &Self::InlineShorthand { todo!("TODO(port): @field projection") }
        fn make_top(_v: LengthPercentageOrAuto) -> Property { todo!("TODO(port): @unionInit") }
        fn make_bottom(_v: LengthPercentageOrAuto) -> Property { todo!("TODO(port): @unionInit") }
        fn make_left(_v: LengthPercentageOrAuto) -> Property { todo!("TODO(port): @unionInit") }
        fn make_right(_v: LengthPercentageOrAuto) -> Property { todo!("TODO(port): @unionInit") }
        fn make_block_start(_v: LengthPercentageOrAuto) -> Property { todo!("TODO(port): @unionInit") }
        fn make_block_end(_v: LengthPercentageOrAuto) -> Property { todo!("TODO(port): @unionInit") }
        fn make_inline_start(_v: LengthPercentageOrAuto) -> Property { todo!("TODO(port): @unionInit") }
        fn make_inline_end(_v: LengthPercentageOrAuto) -> Property { todo!("TODO(port): @unionInit") }
        fn make_shorthand(
            _top: LengthPercentageOrAuto, _bottom: LengthPercentageOrAuto,
            _left: LengthPercentageOrAuto, _right: LengthPercentageOrAuto,
        ) -> Property { todo!("TODO(port): @unionInit") }
        fn make_block_shorthand(_s: LengthPercentageOrAuto, _e: LengthPercentageOrAuto) -> Property { todo!("TODO(port): @unionInit") }
        fn make_inline_shorthand(_s: LengthPercentageOrAuto, _e: LengthPercentageOrAuto) -> Property { todo!("TODO(port): @unionInit") }
        fn shorthand_top(_v: &Self::Shorthand) -> &LengthPercentageOrAuto { todo!("TODO(port)") }
        fn shorthand_right(_v: &Self::Shorthand) -> &LengthPercentageOrAuto { todo!("TODO(port)") }
        fn shorthand_bottom(_v: &Self::Shorthand) -> &LengthPercentageOrAuto { todo!("TODO(port)") }
        fn shorthand_left(_v: &Self::Shorthand) -> &LengthPercentageOrAuto { todo!("TODO(port)") }
        fn block_shorthand_start(_v: &Self::BlockShorthand) -> &LengthPercentageOrAuto { todo!("TODO(port)") }
        fn block_shorthand_end(_v: &Self::BlockShorthand) -> &LengthPercentageOrAuto { todo!("TODO(port)") }
        fn inline_shorthand_start(_v: &Self::InlineShorthand) -> &LengthPercentageOrAuto { todo!("TODO(port)") }
        fn inline_shorthand_end(_v: &Self::InlineShorthand) -> &LengthPercentageOrAuto { todo!("TODO(port)") }
    };
}

pub struct MarginSpec;
impl SizeHandlerSpec for MarginSpec {
    const TOP: PropertyIdTag = PropertyIdTag::MarginTop;
    const BOTTOM: PropertyIdTag = PropertyIdTag::MarginBottom;
    const LEFT: PropertyIdTag = PropertyIdTag::MarginLeft;
    const RIGHT: PropertyIdTag = PropertyIdTag::MarginRight;
    const BLOCK_START: PropertyIdTag = PropertyIdTag::MarginBlockStart;
    const BLOCK_END: PropertyIdTag = PropertyIdTag::MarginBlockEnd;
    const INLINE_START: PropertyIdTag = PropertyIdTag::MarginInlineStart;
    const INLINE_END: PropertyIdTag = PropertyIdTag::MarginInlineEnd;
    const SHORTHAND: PropertyIdTag = PropertyIdTag::Margin;
    const BLOCK_SHORTHAND: PropertyIdTag = PropertyIdTag::MarginBlock;
    const INLINE_SHORTHAND: PropertyIdTag = PropertyIdTag::MarginInline;
    const SHORTHAND_CATEGORY: PropertyCategory = PropertyCategory::Physical;
    const FEATURE: Option<Feature> = Some(Feature::LogicalMargin);
    const SHORTHAND_FEATURE: Option<Feature> = Some(Feature::LogicalMarginShorthand);
    type Shorthand = Margin;
    type BlockShorthand = MarginBlock;
    type InlineShorthand = MarginInline;
    stub_spec_projections!();
}

pub struct PaddingSpec;
impl SizeHandlerSpec for PaddingSpec {
    const TOP: PropertyIdTag = PropertyIdTag::PaddingTop;
    const BOTTOM: PropertyIdTag = PropertyIdTag::PaddingBottom;
    const LEFT: PropertyIdTag = PropertyIdTag::PaddingLeft;
    const RIGHT: PropertyIdTag = PropertyIdTag::PaddingRight;
    const BLOCK_START: PropertyIdTag = PropertyIdTag::PaddingBlockStart;
    const BLOCK_END: PropertyIdTag = PropertyIdTag::PaddingBlockEnd;
    const INLINE_START: PropertyIdTag = PropertyIdTag::PaddingInlineStart;
    const INLINE_END: PropertyIdTag = PropertyIdTag::PaddingInlineEnd;
    const SHORTHAND: PropertyIdTag = PropertyIdTag::Padding;
    const BLOCK_SHORTHAND: PropertyIdTag = PropertyIdTag::PaddingBlock;
    const INLINE_SHORTHAND: PropertyIdTag = PropertyIdTag::PaddingInline;
    const SHORTHAND_CATEGORY: PropertyCategory = PropertyCategory::Physical;
    const FEATURE: Option<Feature> = Some(Feature::LogicalPadding);
    const SHORTHAND_FEATURE: Option<Feature> = Some(Feature::LogicalPaddingShorthand);
    type Shorthand = Padding;
    type BlockShorthand = PaddingBlock;
    type InlineShorthand = PaddingInline;
    stub_spec_projections!();
}

pub struct ScrollMarginSpec;
impl SizeHandlerSpec for ScrollMarginSpec {
    const TOP: PropertyIdTag = PropertyIdTag::ScrollMarginTop;
    const BOTTOM: PropertyIdTag = PropertyIdTag::ScrollMarginBottom;
    const LEFT: PropertyIdTag = PropertyIdTag::ScrollMarginLeft;
    const RIGHT: PropertyIdTag = PropertyIdTag::ScrollMarginRight;
    const BLOCK_START: PropertyIdTag = PropertyIdTag::ScrollMarginBlockStart;
    const BLOCK_END: PropertyIdTag = PropertyIdTag::ScrollMarginBlockEnd;
    const INLINE_START: PropertyIdTag = PropertyIdTag::ScrollMarginInlineStart;
    const INLINE_END: PropertyIdTag = PropertyIdTag::ScrollMarginInlineEnd;
    const SHORTHAND: PropertyIdTag = PropertyIdTag::ScrollMargin;
    const BLOCK_SHORTHAND: PropertyIdTag = PropertyIdTag::ScrollMarginBlock;
    const INLINE_SHORTHAND: PropertyIdTag = PropertyIdTag::ScrollMarginInline;
    const SHORTHAND_CATEGORY: PropertyCategory = PropertyCategory::Physical;
    const FEATURE: Option<Feature> = None;
    const SHORTHAND_FEATURE: Option<Feature> = None;
    type Shorthand = ScrollMargin;
    type BlockShorthand = ScrollMarginBlock;
    type InlineShorthand = ScrollMarginInline;
    stub_spec_projections!();
}

pub struct InsetSpec;
impl SizeHandlerSpec for InsetSpec {
    const TOP: PropertyIdTag = PropertyIdTag::Top;
    const BOTTOM: PropertyIdTag = PropertyIdTag::Bottom;
    const LEFT: PropertyIdTag = PropertyIdTag::Left;
    const RIGHT: PropertyIdTag = PropertyIdTag::Right;
    const BLOCK_START: PropertyIdTag = PropertyIdTag::InsetBlockStart;
    const BLOCK_END: PropertyIdTag = PropertyIdTag::InsetBlockEnd;
    const INLINE_START: PropertyIdTag = PropertyIdTag::InsetInlineStart;
    const INLINE_END: PropertyIdTag = PropertyIdTag::InsetInlineEnd;
    const SHORTHAND: PropertyIdTag = PropertyIdTag::Inset;
    const BLOCK_SHORTHAND: PropertyIdTag = PropertyIdTag::InsetBlock;
    const INLINE_SHORTHAND: PropertyIdTag = PropertyIdTag::InsetInline;
    const SHORTHAND_CATEGORY: PropertyCategory = PropertyCategory::Physical;
    const FEATURE: Option<Feature> = Some(Feature::LogicalInset);
    const SHORTHAND_FEATURE: Option<Feature> = Some(Feature::LogicalInset);
    type Shorthand = Inset;
    type BlockShorthand = InsetBlock;
    type InlineShorthand = InsetInline;
    stub_spec_projections!();
}

// NOTE: Zig also defined `ScrollPadding{,Block,Inline}` value types above but
// did NOT instantiate a `ScrollPaddingHandler` — matching that here.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/properties/margin_padding.zig (852 lines)
//   confidence: medium
//   todos:      6
//   notes:      NewSizeHandler's @field/@unionInit reflection lifted into a SizeHandlerSpec trait; per-spec extract/make projections are todo!() stubs (mechanical match arms) — generate via macro in Phase B. RectShorthand/SizeShorthand assumed as traits providing parse/to_css.
// ──────────────────────────────────────────────────────────────────────────
