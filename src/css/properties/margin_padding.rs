#![warn(unused_must_use)]
use crate::compat::Feature;
use crate::css_values::length::LengthPercentageOrAuto;
use crate::logical::PropertyCategory;
use crate::properties::{Property, PropertyId, PropertyIdTag};
use crate::{DeclarationList, PropertyHandlerContext};
use bun_alloc::ArenaVecExt as _;

// The rect-shorthand structs
// below are stamped out by `define_rect_shorthand!` (struct
// + deep_clone/eql + parse/to_css); the size-shorthand
// structs keep hand-written bodies and get parse/to_css from
// `impl_size_shorthand!`. Both macros live in the parent `properties/mod.rs`
// (shared with `border.rs`).

impl_size_shorthand!(InsetBlock, LengthPercentageOrAuto, block_start, block_end);
impl_size_shorthand!(
    InsetInline,
    LengthPercentageOrAuto,
    inline_start,
    inline_end
);
impl_size_shorthand!(MarginBlock, LengthPercentageOrAuto, block_start, block_end);
impl_size_shorthand!(
    MarginInline,
    LengthPercentageOrAuto,
    inline_start,
    inline_end
);
impl_size_shorthand!(PaddingBlock, LengthPercentageOrAuto, block_start, block_end);
impl_size_shorthand!(
    PaddingInline,
    LengthPercentageOrAuto,
    inline_start,
    inline_end
);
impl_size_shorthand!(
    ScrollMarginBlock,
    LengthPercentageOrAuto,
    block_start,
    block_end
);
impl_size_shorthand!(
    ScrollMarginInline,
    LengthPercentageOrAuto,
    inline_start,
    inline_end
);
impl_size_shorthand!(
    ScrollPaddingBlock,
    LengthPercentageOrAuto,
    block_start,
    block_end
);
impl_size_shorthand!(
    ScrollPaddingInline,
    LengthPercentageOrAuto,
    inline_start,
    inline_end
);

// ──────────────────────────────────────────────────────────────────────────
// Shorthand value types
// ──────────────────────────────────────────────────────────────────────────
//
// Trait impls (`RectShorthand`) provide default
// `parse`/`to_css`. A `#[derive]` could replace the manual impls.
//
// `implementDeepClone` / `implementEql` are field-wise reflection helpers →
// `#[derive(Clone, PartialEq)]`; the `DeepClone`/`CssEql` trait impls are
// bridged via `bridge_clone_partialeq!` in `generics.rs`.
//
// `PropertyFieldMap` (an anonymous struct mapping field-name → PropertyIdTag)
// becomes an associated const slice; consumers that did `@field(map, name)`
// will look up by name. (If consumers ever need O(1) by-field access, this
// could switch to per-type associated consts.)

define_rect_shorthand! {
    /// A value for the [inset](https://drafts.csswg.org/css-logical/#propdef-inset) shorthand property.
    Inset, LengthPercentageOrAuto,
    top: Top,
    right: Right,
    bottom: Bottom,
    left: Left
}

/// A value for the [inset-block](https://drafts.csswg.org/css-logical/#propdef-inset-block) shorthand property.
#[derive(Clone, PartialEq)]
pub struct InsetBlock {
    /// The block start value.
    pub(crate) block_start: LengthPercentageOrAuto,
    /// The block end value.
    pub(crate) block_end: LengthPercentageOrAuto,
}

impl InsetBlock {
    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"inset-block");
}

/// A value for the [inset-inline](https://drafts.csswg.org/css-logical/#propdef-inset-inline) shorthand property.
#[derive(Clone, PartialEq)]
pub struct InsetInline {
    /// The inline start value.
    pub(crate) inline_start: LengthPercentageOrAuto,
    /// The inline end value.
    pub(crate) inline_end: LengthPercentageOrAuto,
}

impl InsetInline {
    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"inset-inline");
}

/// A value for the [margin-block](https://drafts.csswg.org/css-logical/#propdef-margin-block) shorthand property.
#[derive(Clone, PartialEq)]
pub struct MarginBlock {
    /// The block start value.
    pub(crate) block_start: LengthPercentageOrAuto,
    /// The block end value.
    pub(crate) block_end: LengthPercentageOrAuto,
}

impl MarginBlock {
    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"margin-block");
}

/// A value for the [margin-inline](https://drafts.csswg.org/css-logical/#propdef-margin-inline) shorthand property.
#[derive(Clone, PartialEq)]
pub struct MarginInline {
    /// The inline start value.
    pub(crate) inline_start: LengthPercentageOrAuto,
    /// The inline end value.
    pub(crate) inline_end: LengthPercentageOrAuto,
}

impl MarginInline {
    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"margin-inline");
}

define_rect_shorthand! {
    /// A value for the [margin](https://drafts.csswg.org/css-box-4/#propdef-margin) shorthand property.
    Margin, LengthPercentageOrAuto,
    top: MarginTop,
    right: MarginRight,
    bottom: MarginBottom,
    left: MarginLeft
}

/// A value for the [padding-block](https://drafts.csswg.org/css-logical/#propdef-padding-block) shorthand property.
#[derive(Clone, PartialEq)]
pub struct PaddingBlock {
    /// The block start value.
    pub(crate) block_start: LengthPercentageOrAuto,
    /// The block end value.
    pub(crate) block_end: LengthPercentageOrAuto,
}

impl PaddingBlock {
    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"padding-block");
}

/// A value for the [padding-inline](https://drafts.csswg.org/css-logical/#propdef-padding-inline) shorthand property.
#[derive(Clone, PartialEq)]
pub struct PaddingInline {
    /// The inline start value.
    pub(crate) inline_start: LengthPercentageOrAuto,
    /// The inline end value.
    pub(crate) inline_end: LengthPercentageOrAuto,
}

impl PaddingInline {
    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"padding-inline");
}

define_rect_shorthand! {
    /// A value for the [padding](https://drafts.csswg.org/css-box-4/#propdef-padding) shorthand property.
    Padding, LengthPercentageOrAuto,
    top: PaddingTop,
    right: PaddingRight,
    bottom: PaddingBottom,
    left: PaddingLeft
}

/// A value for the [scroll-margin-block](https://drafts.csswg.org/css-scroll-snap/#propdef-scroll-margin-block) shorthand property.
#[derive(Clone, PartialEq)]
pub struct ScrollMarginBlock {
    /// The block start value.
    pub(crate) block_start: LengthPercentageOrAuto,
    /// The block end value.
    pub(crate) block_end: LengthPercentageOrAuto,
}

impl ScrollMarginBlock {
    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"scroll-margin-block");
}

/// A value for the [scroll-margin-inline](https://drafts.csswg.org/css-scroll-snap/#propdef-scroll-margin-inline) shorthand property.
#[derive(Clone, PartialEq)]
pub struct ScrollMarginInline {
    /// The inline start value.
    pub(crate) inline_start: LengthPercentageOrAuto,
    /// The inline end value.
    pub(crate) inline_end: LengthPercentageOrAuto,
}

impl ScrollMarginInline {
    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"scroll-margin-inline");
}

define_rect_shorthand! {
    /// A value for the [scroll-margin](https://drafts.csswg.org/css-scroll-snap/#scroll-margin) shorthand property.
    ScrollMargin, LengthPercentageOrAuto,
    top: ScrollMarginTop,
    right: ScrollMarginRight,
    bottom: ScrollMarginBottom,
    left: ScrollMarginLeft
}

/// A value for the [scroll-padding-block](https://drafts.csswg.org/css-scroll-snap/#propdef-scroll-padding-block) shorthand property.
#[derive(Clone, PartialEq)]
pub struct ScrollPaddingBlock {
    /// The block start value.
    pub(crate) block_start: LengthPercentageOrAuto,
    /// The block end value.
    pub(crate) block_end: LengthPercentageOrAuto,
}

impl ScrollPaddingBlock {
    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"scroll-padding-block");
}

/// A value for the [scroll-padding-inline](https://drafts.csswg.org/css-scroll-snap/#propdef-scroll-padding-inline) shorthand property.
#[derive(Clone, PartialEq)]
pub struct ScrollPaddingInline {
    /// The inline start value.
    pub(crate) inline_start: LengthPercentageOrAuto,
    /// The inline end value.
    pub(crate) inline_end: LengthPercentageOrAuto,
}

impl ScrollPaddingInline {
    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"scroll-padding-inline");
}

define_rect_shorthand! {
    /// A value for the [scroll-padding](https://drafts.csswg.org/css-scroll-snap/#scroll-padding) shorthand property.
    ScrollPadding, LengthPercentageOrAuto,
    top: ScrollPaddingTop,
    right: ScrollPaddingRight,
    bottom: ScrollPaddingBottom,
    left: ScrollPaddingLeft
}

// ──────────────────────────────────────────────────────────────────────────
// Handlers
// ──────────────────────────────────────────────────────────────────────────

pub type MarginHandler = SizeHandler<MarginSpec>;
pub type PaddingHandler = SizeHandler<PaddingSpec>;
pub type ScrollMarginHandler = SizeHandler<ScrollMarginSpec>;
pub type InsetHandler = SizeHandler<InsetSpec>;

// ──────────────────────────────────────────────────────────────────────────
// SizeHandler
// ──────────────────────────────────────────────────────────────────────────
//
// The per-variant projection in/out of the `Property` tagged union lives in
// a `SizeHandlerSpec` trait. The generic body (`handle_property` / `flush` /
// helpers) calls through `S::*`. Each concrete handler is a zero-sized
// marker type implementing the spec.
//
// A macro could generate the four `SizeHandlerSpec` impls from a single
// argument table, eliminating the per-spec extract/construct boilerplate.
// Left explicit for reviewability.

/// Selector for the four physical slots on `SizeHandler`.
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
pub trait SizeHandlerSpec {
    // ---- tag parameters ----
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
    // `PropertyId` mirrors of TOP/BOTTOM/LEFT/RIGHT for
    // `UnparsedProperty::with_property_id`. All margin/padding/inset/scroll-*
    // `PropertyId` variants are payload-free, so these are well-formed consts.
    const TOP_ID: PropertyId;
    const BOTTOM_ID: PropertyId;
    const LEFT_ID: PropertyId;
    const RIGHT_ID: PropertyId;
    const SHORTHAND_CATEGORY: PropertyCategory;
    /// Optional prefix feature for the shorthand.
    const FEATURE: Option<Feature>;
    /// `shorthand_extra.?.shorthand_feature`.
    const SHORTHAND_FEATURE: Option<Feature>;

    // ---- value-type bindings ----
    // In every instantiation in this file the longhand value type is
    // `LengthPercentageOrAuto`, so the generic body below uses that
    // concretely. If a future spec needs a different `valueType()`, lift it
    // to an associated type here.

    /// The 4-field rect struct.
    type Shorthand;
    /// The 2-field block struct.
    type BlockShorthand;
    /// The 2-field inline struct.
    type InlineShorthand;

    // ---- @field / @unionInit replacements ----
    // Each pair is the Rust spelling of:
    //   `@field(property, @tagName(X_prop))`       → extract_x
    //   `@unionInit(Property, @tagName(X_prop), v)` → make_x
    // These are pure mechanical pattern-matches over `Property`; they could
    // be generated via macro.

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

    // Field accessors on the shorthand value structs.
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
pub struct SizeHandler<S: SizeHandlerSpec> {
    pub(crate) top: Option<LengthPercentageOrAuto>,
    pub(crate) bottom: Option<LengthPercentageOrAuto>,
    pub(crate) left: Option<LengthPercentageOrAuto>,
    pub(crate) right: Option<LengthPercentageOrAuto>,
    pub(crate) block_start: Option<Property>,
    pub(crate) block_end: Option<Property>,
    pub(crate) inline_start: Option<Property>,
    pub(crate) inline_end: Option<Property>,
    pub(crate) has_any: bool,
    pub(crate) category: PropertyCategory,
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

// `context.arena` was dropped from PropertyHandlerContext; the
// arena is recovered via `dest.bump()` (DeclarationList = bumpalo::Vec).
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

    pub(crate) fn handle_property(
        &mut self,
        property: &Property,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) -> bool {
        // Match on the *raw* union discriminant (`Property::variant_tag()`).
        // The `Unparsed` arm needs the inner `property_id` to decide whether
        // the unparsed value belongs to this handler, so it stays a
        // structural match.
        if let Property::Unparsed(unparsed) = property {
            let id = unparsed.property_id.tag();
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
                let bump = dest.bump();
                // Even if we weren't able to parse the value (e.g. due to var() references),
                // we can still add vendor prefixes to the property itself.
                if id == S::BLOCK_START {
                    self.logical_property_helper(
                        LogicalSlot::BlockStart,
                        Property::Unparsed(unparsed.deep_clone(bump)),
                        dest,
                        context,
                    );
                } else if id == S::BLOCK_END {
                    self.logical_property_helper(
                        LogicalSlot::BlockEnd,
                        Property::Unparsed(unparsed.deep_clone(bump)),
                        dest,
                        context,
                    );
                } else if id == S::INLINE_START {
                    self.logical_property_helper(
                        LogicalSlot::InlineStart,
                        Property::Unparsed(unparsed.deep_clone(bump)),
                        dest,
                        context,
                    );
                } else if id == S::INLINE_END {
                    self.logical_property_helper(
                        LogicalSlot::InlineEnd,
                        Property::Unparsed(unparsed.deep_clone(bump)),
                        dest,
                        context,
                    );
                } else {
                    self.flush(dest, context);
                    dest.push(Property::Unparsed(unparsed.deep_clone(bump)));
                }
            } else {
                return false;
            }
            return true;
        }

        let tag = property.variant_tag();
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
            // Reconstruct via the spec's `make_X(extract_X)` pair.
            self.logical_property_helper(
                LogicalSlot::BlockStart,
                S::make_block_start(S::extract_block_start(property).clone()),
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
            self.logical_property_helper(
                LogicalSlot::BlockEnd,
                S::make_block_end(S::extract_block_end(property).clone()),
                dest,
                context,
            );
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
                S::make_inline_start(S::extract_inline_start(property).clone()),
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
                S::make_inline_end(S::extract_inline_end(property).clone()),
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
                S::make_block_start(S::block_shorthand_start(val).clone()),
                dest,
                context,
            );
            self.logical_property_helper(
                LogicalSlot::BlockEnd,
                S::make_block_end(S::block_shorthand_end(val).clone()),
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
                S::make_inline_start(S::inline_shorthand_start(val).clone()),
                dest,
                context,
            );
            self.logical_property_helper(
                LogicalSlot::InlineEnd,
                S::make_inline_end(S::inline_shorthand_end(val).clone()),
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
            self.top = Some(S::shorthand_top(val).clone());
            self.right = Some(S::shorthand_right(val).clone());
            self.bottom = Some(S::shorthand_bottom(val).clone());
            self.left = Some(S::shorthand_left(val).clone());
            self.block_start = None;
            self.block_end = None;
            self.inline_start = None;
            self.inline_end = None;
            self.has_any = true;
        } else {
            return false;
        }

        true
    }

    pub(crate) fn finalize(
        &mut self,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) {
        self.flush(dest, context);
    }

    // The flush helper is split into `flush_helper_physical` + `flush_helper_logical`
    // because the physical slots hold `Option<LengthPercentageOrAuto>` and the
    // logical slots hold `Option<Property>`.

    /// Flush helper for the four physical slots (`top`/`bottom`/`left`/`right`).
    fn flush_helper_physical(
        &mut self,
        field: PhysicalSlot,
        val: &LengthPercentageOrAuto,
        category: PropertyCategory,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) {
        // If the category changes betweet logical and physical,
        // or if the value contains syntax that isn't supported across all targets,
        // preserve the previous value as a fallback.
        if category != self.category
            || (self.physical_slot_is_some(field)
                && context.targets.browsers.is_some()
                && !val.is_compatible(&context.targets.browsers.unwrap()))
        {
            self.flush(dest, context);
        }
    }

    /// Flush helper for the four logical slots (`block_start`/.../`inline_end`).
    fn flush_helper_logical(
        &mut self,
        field: LogicalSlot,
        val: &LengthPercentageOrAuto,
        category: PropertyCategory,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) {
        // If the category changes betweet logical and physical,
        // or if the value contains syntax that isn't supported across all targets,
        // preserve the previous value as a fallback.
        if category != self.category
            || (self.logical_slot_is_some(field)
                && context.targets.browsers.is_some()
                && !val.is_compatible(&context.targets.browsers.unwrap()))
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
        self.flush_helper_physical(field, val, category, dest, context);
        *self.physical_slot(field) = Some(val.clone());
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

        // Assigning over the Option drops the old value.
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

        match (top, bottom, left, right) {
            (Some(top), Some(bottom), Some(left), Some(right))
                if S::SHORTHAND_CATEGORY != PropertyCategory::Logical || logical_supported =>
            {
                dest.push(S::make_shorthand(top, bottom, left, right));
            }
            (top, bottom, left, right) => {
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
                S::TOP_ID,
                dest,
                context,
            );
            Self::prop(
                &mut block_end,
                S::BLOCK_END,
                S::extract_block_end,
                S::make_bottom,
                S::BOTTOM_ID,
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
            // Raw union-tag equality, which is `false` for `Unparsed`.
            let start_matches = inline_start
                .as_ref()
                .map(|p| p.variant_tag() == S::INLINE_START)
                .unwrap_or(false);
            let end_matches = inline_end
                .as_ref()
                .map(|p| p.variant_tag() == S::INLINE_END)
                .unwrap_or(false);
            let values_equal = if start_matches && end_matches {
                S::extract_inline_start(inline_start.as_ref().unwrap())
                    == S::extract_inline_end(inline_end.as_ref().unwrap())
            } else {
                false
            };

            if start_matches && end_matches && values_equal {
                Self::prop(
                    &mut inline_start,
                    S::INLINE_START,
                    S::extract_inline_start,
                    S::make_left,
                    S::LEFT_ID,
                    dest,
                    context,
                );
                Self::prop(
                    &mut inline_end,
                    S::INLINE_END,
                    S::extract_inline_end,
                    S::make_right,
                    S::RIGHT_ID,
                    dest,
                    context,
                );
            } else {
                Self::logical_prop_helper(
                    &mut inline_start,
                    S::INLINE_START,
                    S::extract_inline_start,
                    S::make_left,
                    S::LEFT_ID,
                    S::make_right,
                    S::RIGHT_ID,
                    dest,
                    context,
                );
                Self::logical_prop_helper(
                    &mut inline_end,
                    S::INLINE_END,
                    S::extract_inline_end,
                    S::make_right,
                    S::RIGHT_ID,
                    S::make_left,
                    S::LEFT_ID,
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
        ltr: PropertyId,
        make_rtl: fn(LengthPercentageOrAuto) -> Property,
        rtl: PropertyId,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) {
        // _ = this; // autofix
        let bump = dest.bump();
        if let Some(v_) = val.as_ref() {
            // Raw discriminant comparison.
            if v_.variant_tag() == logical {
                let v = extract_logical(v_);
                context.add_logical_rule(make_ltr(v.clone()), make_rtl(v.clone()));
            } else if let Property::Unparsed(v) = v_ {
                context.add_logical_rule(
                    Property::Unparsed(v.with_property_id(bump, ltr)),
                    Property::Unparsed(v.with_property_id(bump, rtl)),
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

        // Raw discriminant comparison. `variant_tag()` keeps `Unparsed` distinct so an
        // unparsed longhand falls through to the else branch and is appended
        // as-is, instead of hitting `unreachable!()` in `extract_*`.
        if start
            .as_ref()
            .map(|p| p.variant_tag() == start_prop)
            .unwrap_or(false)
            && end
                .as_ref()
                .map(|p| p.variant_tag() == end_prop)
                .unwrap_or(false)
            && shorthand_supported
        {
            // The ≤2-field invariant is upheld structurally by `make_*_shorthand`.
            let start_v = match pair {
                LogicalSidePair::Block => S::extract_block_start(start.as_ref().unwrap()).clone(),
                LogicalSidePair::Inline => S::extract_inline_start(start.as_ref().unwrap()).clone(),
            };
            let end_v = match pair {
                LogicalSidePair::Block => S::extract_block_end(end.as_ref().unwrap()).clone(),
                LogicalSidePair::Inline => S::extract_inline_end(end.as_ref().unwrap()).clone(),
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
        physical: PropertyId,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) {
        // _ = this; // autofix
        let _ = context;
        let bump = dest.bump();
        if let Some(v) = val.as_ref() {
            // Raw discriminant comparison.
            if v.variant_tag() == logical {
                // Clone instead of moving out of `&Property`;
                // `LengthPercentageOrAuto` is small.
                dest.push(make_physical(extract_logical(v).clone()));
            } else if let Property::Unparsed(u) = v {
                dest.push(Property::Unparsed(u.with_property_id(bump, physical)));
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
// `size_handler_spec_projections!` expands the `extract_*` / `make_*` /
// `shorthand_*` bodies from the 11 `Property` variant idents + 3 shorthand
// value-type idents.

macro_rules! size_handler_spec_projections {
    (
        $Top:ident, $Bottom:ident, $Left:ident, $Right:ident,
        $BlockStart:ident, $BlockEnd:ident, $InlineStart:ident, $InlineEnd:ident,
        $Shorthand:ident, $BlockShorthand:ident, $InlineShorthand:ident,
        $ShorthandTy:ident, $BlockShorthandTy:ident, $InlineShorthandTy:ident
    ) => {
        const TOP_ID: PropertyId = PropertyId::$Top;
        const BOTTOM_ID: PropertyId = PropertyId::$Bottom;
        const LEFT_ID: PropertyId = PropertyId::$Left;
        const RIGHT_ID: PropertyId = PropertyId::$Right;

        fn extract_top(p: &Property) -> &LengthPercentageOrAuto {
            match p {
                Property::$Top(v) => v,
                _ => unreachable!(),
            }
        }
        fn extract_bottom(p: &Property) -> &LengthPercentageOrAuto {
            match p {
                Property::$Bottom(v) => v,
                _ => unreachable!(),
            }
        }
        fn extract_left(p: &Property) -> &LengthPercentageOrAuto {
            match p {
                Property::$Left(v) => v,
                _ => unreachable!(),
            }
        }
        fn extract_right(p: &Property) -> &LengthPercentageOrAuto {
            match p {
                Property::$Right(v) => v,
                _ => unreachable!(),
            }
        }
        fn extract_block_start(p: &Property) -> &LengthPercentageOrAuto {
            match p {
                Property::$BlockStart(v) => v,
                _ => unreachable!(),
            }
        }
        fn extract_block_end(p: &Property) -> &LengthPercentageOrAuto {
            match p {
                Property::$BlockEnd(v) => v,
                _ => unreachable!(),
            }
        }
        fn extract_inline_start(p: &Property) -> &LengthPercentageOrAuto {
            match p {
                Property::$InlineStart(v) => v,
                _ => unreachable!(),
            }
        }
        fn extract_inline_end(p: &Property) -> &LengthPercentageOrAuto {
            match p {
                Property::$InlineEnd(v) => v,
                _ => unreachable!(),
            }
        }
        fn extract_shorthand(p: &Property) -> &Self::Shorthand {
            match p {
                Property::$Shorthand(v) => v,
                _ => unreachable!(),
            }
        }
        fn extract_block_shorthand(p: &Property) -> &Self::BlockShorthand {
            match p {
                Property::$BlockShorthand(v) => v,
                _ => unreachable!(),
            }
        }
        fn extract_inline_shorthand(p: &Property) -> &Self::InlineShorthand {
            match p {
                Property::$InlineShorthand(v) => v,
                _ => unreachable!(),
            }
        }
        fn make_top(v: LengthPercentageOrAuto) -> Property {
            Property::$Top(v)
        }
        fn make_bottom(v: LengthPercentageOrAuto) -> Property {
            Property::$Bottom(v)
        }
        fn make_left(v: LengthPercentageOrAuto) -> Property {
            Property::$Left(v)
        }
        fn make_right(v: LengthPercentageOrAuto) -> Property {
            Property::$Right(v)
        }
        fn make_block_start(v: LengthPercentageOrAuto) -> Property {
            Property::$BlockStart(v)
        }
        fn make_block_end(v: LengthPercentageOrAuto) -> Property {
            Property::$BlockEnd(v)
        }
        fn make_inline_start(v: LengthPercentageOrAuto) -> Property {
            Property::$InlineStart(v)
        }
        fn make_inline_end(v: LengthPercentageOrAuto) -> Property {
            Property::$InlineEnd(v)
        }
        fn make_shorthand(
            top: LengthPercentageOrAuto,
            bottom: LengthPercentageOrAuto,
            left: LengthPercentageOrAuto,
            right: LengthPercentageOrAuto,
        ) -> Property {
            Property::$Shorthand($ShorthandTy {
                top,
                right,
                bottom,
                left,
            })
        }
        fn make_block_shorthand(s: LengthPercentageOrAuto, e: LengthPercentageOrAuto) -> Property {
            Property::$BlockShorthand($BlockShorthandTy {
                block_start: s,
                block_end: e,
            })
        }
        fn make_inline_shorthand(s: LengthPercentageOrAuto, e: LengthPercentageOrAuto) -> Property {
            Property::$InlineShorthand($InlineShorthandTy {
                inline_start: s,
                inline_end: e,
            })
        }
        fn shorthand_top(v: &Self::Shorthand) -> &LengthPercentageOrAuto {
            &v.top
        }
        fn shorthand_right(v: &Self::Shorthand) -> &LengthPercentageOrAuto {
            &v.right
        }
        fn shorthand_bottom(v: &Self::Shorthand) -> &LengthPercentageOrAuto {
            &v.bottom
        }
        fn shorthand_left(v: &Self::Shorthand) -> &LengthPercentageOrAuto {
            &v.left
        }
        fn block_shorthand_start(v: &Self::BlockShorthand) -> &LengthPercentageOrAuto {
            &v.block_start
        }
        fn block_shorthand_end(v: &Self::BlockShorthand) -> &LengthPercentageOrAuto {
            &v.block_end
        }
        fn inline_shorthand_start(v: &Self::InlineShorthand) -> &LengthPercentageOrAuto {
            &v.inline_start
        }
        fn inline_shorthand_end(v: &Self::InlineShorthand) -> &LengthPercentageOrAuto {
            &v.inline_end
        }
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
    size_handler_spec_projections!(
        MarginTop,
        MarginBottom,
        MarginLeft,
        MarginRight,
        MarginBlockStart,
        MarginBlockEnd,
        MarginInlineStart,
        MarginInlineEnd,
        Margin,
        MarginBlock,
        MarginInline,
        Margin,
        MarginBlock,
        MarginInline
    );
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
    size_handler_spec_projections!(
        PaddingTop,
        PaddingBottom,
        PaddingLeft,
        PaddingRight,
        PaddingBlockStart,
        PaddingBlockEnd,
        PaddingInlineStart,
        PaddingInlineEnd,
        Padding,
        PaddingBlock,
        PaddingInline,
        Padding,
        PaddingBlock,
        PaddingInline
    );
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
    size_handler_spec_projections!(
        ScrollMarginTop,
        ScrollMarginBottom,
        ScrollMarginLeft,
        ScrollMarginRight,
        ScrollMarginBlockStart,
        ScrollMarginBlockEnd,
        ScrollMarginInlineStart,
        ScrollMarginInlineEnd,
        ScrollMargin,
        ScrollMarginBlock,
        ScrollMarginInline,
        ScrollMargin,
        ScrollMarginBlock,
        ScrollMarginInline
    );
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
    size_handler_spec_projections!(
        Top,
        Bottom,
        Left,
        Right,
        InsetBlockStart,
        InsetBlockEnd,
        InsetInlineStart,
        InsetInlineEnd,
        Inset,
        InsetBlock,
        InsetInline,
        Inset,
        InsetBlock,
        InsetInline
    );
}

// NOTE: `ScrollPadding{,Block,Inline}` value types are defined above but no
// `ScrollPaddingHandler` is instantiated.
