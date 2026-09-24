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
// a static `SizeSpec` table (one per `SizeHandlerSpec` marker type); the
// handler body is compiled once and reads it at runtime.

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

/// Configuration for one `SizeHandler` instantiation. The handler body is
/// compiled once and reads everything property-specific from `SPEC`.
pub trait SizeHandlerSpec {
    const SPEC: &'static SizeSpec;
}

type Extract = fn(&Property) -> &LengthPercentageOrAuto;
type Make = fn(LengthPercentageOrAuto) -> Property;

pub struct SizeSpec {
    top: PropertyIdTag,
    bottom: PropertyIdTag,
    left: PropertyIdTag,
    right: PropertyIdTag,
    block_start: PropertyIdTag,
    block_end: PropertyIdTag,
    inline_start: PropertyIdTag,
    inline_end: PropertyIdTag,
    shorthand: PropertyIdTag,
    block_shorthand: PropertyIdTag,
    inline_shorthand: PropertyIdTag,
    // `PropertyId` mirrors of top/bottom/left/right for
    // `UnparsedProperty::with_property_id`.
    top_id: PropertyId,
    bottom_id: PropertyId,
    left_id: PropertyId,
    right_id: PropertyId,
    shorthand_category: PropertyCategory,
    /// Optional prefix feature for the shorthand.
    feature: Option<Feature>,
    shorthand_feature: Option<Feature>,

    extract_top: Extract,
    extract_bottom: Extract,
    extract_left: Extract,
    extract_right: Extract,
    extract_block_start: Extract,
    extract_block_end: Extract,
    extract_inline_start: Extract,
    extract_inline_end: Extract,
    /// `[top, right, bottom, left]` of the 4-field shorthand.
    extract_shorthand: fn(&Property) -> [&LengthPercentageOrAuto; 4],
    /// `[start, end]`.
    extract_block_shorthand: fn(&Property) -> [&LengthPercentageOrAuto; 2],
    extract_inline_shorthand: fn(&Property) -> [&LengthPercentageOrAuto; 2],

    make_top: Make,
    make_bottom: Make,
    make_left: Make,
    make_right: Make,
    make_block_start: Make,
    make_block_end: Make,
    make_inline_start: Make,
    make_inline_end: Make,
    /// `(top, bottom, left, right)`.
    make_shorthand: fn(
        LengthPercentageOrAuto,
        LengthPercentageOrAuto,
        LengthPercentageOrAuto,
        LengthPercentageOrAuto,
    ) -> Property,
    make_block_shorthand: fn(LengthPercentageOrAuto, LengthPercentageOrAuto) -> Property,
    make_inline_shorthand: fn(LengthPercentageOrAuto, LengthPercentageOrAuto) -> Property,
}

/// Generic margin/padding/inset/scroll-* handler.
pub struct SizeHandler<S: SizeHandlerSpec> {
    inner: SizeHandlerImpl,
    _spec: core::marker::PhantomData<S>,
}

impl<S: SizeHandlerSpec> Default for SizeHandler<S> {
    fn default() -> Self {
        Self {
            inner: SizeHandlerImpl::default(),
            _spec: core::marker::PhantomData,
        }
    }
}

impl<S: SizeHandlerSpec> SizeHandler<S> {
    #[inline]
    pub(crate) fn handle_property(
        &mut self,
        property: &Property,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) -> bool {
        self.inner.handle_property(S::SPEC, property, dest, context)
    }

    #[inline]
    pub(crate) fn finalize(
        &mut self,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) {
        self.inner.flush(S::SPEC, dest, context);
    }
}

#[derive(Default)]
struct SizeHandlerImpl {
    top: Option<LengthPercentageOrAuto>,
    bottom: Option<LengthPercentageOrAuto>,
    left: Option<LengthPercentageOrAuto>,
    right: Option<LengthPercentageOrAuto>,
    block_start: Option<Property>,
    block_end: Option<Property>,
    inline_start: Option<Property>,
    inline_end: Option<Property>,
    has_any: bool,
    category: PropertyCategory,
}

// `context.arena` was dropped from PropertyHandlerContext; the
// arena is recovered via `dest.bump()` (DeclarationList = bumpalo::Vec).
impl SizeHandlerImpl {
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

    fn handle_property(
        &mut self,
        spec: &'static SizeSpec,
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
            if id == spec.top
                || id == spec.bottom
                || id == spec.left
                || id == spec.right
                || id == spec.block_start
                || id == spec.block_end
                || id == spec.inline_start
                || id == spec.inline_end
                || id == spec.block_shorthand
                || id == spec.inline_shorthand
                || id == spec.shorthand
            {
                let bump = dest.bump();
                // Even if we weren't able to parse the value (e.g. due to var() references),
                // we can still add vendor prefixes to the property itself.
                if id == spec.block_start {
                    self.logical_property_helper(
                        spec,
                        LogicalSlot::BlockStart,
                        Property::Unparsed(unparsed.deep_clone(bump)),
                        dest,
                        context,
                    );
                } else if id == spec.block_end {
                    self.logical_property_helper(
                        spec,
                        LogicalSlot::BlockEnd,
                        Property::Unparsed(unparsed.deep_clone(bump)),
                        dest,
                        context,
                    );
                } else if id == spec.inline_start {
                    self.logical_property_helper(
                        spec,
                        LogicalSlot::InlineStart,
                        Property::Unparsed(unparsed.deep_clone(bump)),
                        dest,
                        context,
                    );
                } else if id == spec.inline_end {
                    self.logical_property_helper(
                        spec,
                        LogicalSlot::InlineEnd,
                        Property::Unparsed(unparsed.deep_clone(bump)),
                        dest,
                        context,
                    );
                } else {
                    self.flush(spec, dest, context);
                    dest.push(Property::Unparsed(unparsed.deep_clone(bump)));
                }
            } else {
                return false;
            }
            return true;
        }

        let tag = property.variant_tag();
        if tag == spec.top {
            self.property_helper(
                spec,
                PhysicalSlot::Top,
                (spec.extract_top)(property),
                PropertyCategory::Physical,
                dest,
                context,
            );
        } else if tag == spec.bottom {
            self.property_helper(
                spec,
                PhysicalSlot::Bottom,
                (spec.extract_bottom)(property),
                PropertyCategory::Physical,
                dest,
                context,
            );
        } else if tag == spec.left {
            self.property_helper(
                spec,
                PhysicalSlot::Left,
                (spec.extract_left)(property),
                PropertyCategory::Physical,
                dest,
                context,
            );
        } else if tag == spec.right {
            self.property_helper(
                spec,
                PhysicalSlot::Right,
                (spec.extract_right)(property),
                PropertyCategory::Physical,
                dest,
                context,
            );
        } else if tag == spec.block_start {
            self.flush_helper_logical(
                spec,
                LogicalSlot::BlockStart,
                (spec.extract_block_start)(property),
                PropertyCategory::Logical,
                dest,
                context,
            );
            // Reconstruct via the spec's `make_X(extract_X)` pair.
            self.logical_property_helper(
                spec,
                LogicalSlot::BlockStart,
                (spec.make_block_start)((spec.extract_block_start)(property).clone()),
                dest,
                context,
            );
        } else if tag == spec.block_end {
            self.flush_helper_logical(
                spec,
                LogicalSlot::BlockEnd,
                (spec.extract_block_end)(property),
                PropertyCategory::Logical,
                dest,
                context,
            );
            self.logical_property_helper(
                spec,
                LogicalSlot::BlockEnd,
                (spec.make_block_end)((spec.extract_block_end)(property).clone()),
                dest,
                context,
            );
        } else if tag == spec.inline_start {
            self.flush_helper_logical(
                spec,
                LogicalSlot::InlineStart,
                (spec.extract_inline_start)(property),
                PropertyCategory::Logical,
                dest,
                context,
            );
            self.logical_property_helper(
                spec,
                LogicalSlot::InlineStart,
                (spec.make_inline_start)((spec.extract_inline_start)(property).clone()),
                dest,
                context,
            );
        } else if tag == spec.inline_end {
            self.flush_helper_logical(
                spec,
                LogicalSlot::InlineEnd,
                (spec.extract_inline_end)(property),
                PropertyCategory::Logical,
                dest,
                context,
            );
            self.logical_property_helper(
                spec,
                LogicalSlot::InlineEnd,
                (spec.make_inline_end)((spec.extract_inline_end)(property).clone()),
                dest,
                context,
            );
        } else if tag == spec.block_shorthand {
            let val = (spec.extract_block_shorthand)(property);
            self.flush_helper_logical(
                spec,
                LogicalSlot::BlockStart,
                val[0],
                PropertyCategory::Logical,
                dest,
                context,
            );
            self.flush_helper_logical(
                spec,
                LogicalSlot::BlockEnd,
                val[1],
                PropertyCategory::Logical,
                dest,
                context,
            );
            self.logical_property_helper(
                spec,
                LogicalSlot::BlockStart,
                (spec.make_block_start)(val[0].clone()),
                dest,
                context,
            );
            self.logical_property_helper(
                spec,
                LogicalSlot::BlockEnd,
                (spec.make_block_end)(val[1].clone()),
                dest,
                context,
            );
        } else if tag == spec.inline_shorthand {
            let val = (spec.extract_inline_shorthand)(property);
            self.flush_helper_logical(
                spec,
                LogicalSlot::InlineStart,
                val[0],
                PropertyCategory::Logical,
                dest,
                context,
            );
            self.flush_helper_logical(
                spec,
                LogicalSlot::InlineEnd,
                val[1],
                PropertyCategory::Logical,
                dest,
                context,
            );
            self.logical_property_helper(
                spec,
                LogicalSlot::InlineStart,
                (spec.make_inline_start)(val[0].clone()),
                dest,
                context,
            );
            self.logical_property_helper(
                spec,
                LogicalSlot::InlineEnd,
                (spec.make_inline_end)(val[1].clone()),
                dest,
                context,
            );
        } else if tag == spec.shorthand {
            let val = (spec.extract_shorthand)(property);
            self.flush_helper_physical(
                spec,
                PhysicalSlot::Top,
                val[0],
                spec.shorthand_category,
                dest,
                context,
            );
            self.flush_helper_physical(
                spec,
                PhysicalSlot::Right,
                val[1],
                spec.shorthand_category,
                dest,
                context,
            );
            self.flush_helper_physical(
                spec,
                PhysicalSlot::Bottom,
                val[2],
                spec.shorthand_category,
                dest,
                context,
            );
            self.flush_helper_physical(
                spec,
                PhysicalSlot::Left,
                val[3],
                spec.shorthand_category,
                dest,
                context,
            );
            self.top = Some(val[0].clone());
            self.right = Some(val[1].clone());
            self.bottom = Some(val[2].clone());
            self.left = Some(val[3].clone());
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

    // The flush helper is split into `flush_helper_physical` + `flush_helper_logical`
    // because the physical slots hold `Option<LengthPercentageOrAuto>` and the
    // logical slots hold `Option<Property>`.

    /// Flush helper for the four physical slots (`top`/`bottom`/`left`/`right`).
    fn flush_helper_physical(
        &mut self,
        spec: &'static SizeSpec,
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
            self.flush(spec, dest, context);
        }
    }

    /// Flush helper for the four logical slots (`block_start`/.../`inline_end`).
    fn flush_helper_logical(
        &mut self,
        spec: &'static SizeSpec,
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
            self.flush(spec, dest, context);
        }
    }

    fn property_helper(
        &mut self,
        spec: &'static SizeSpec,
        field: PhysicalSlot,
        val: &LengthPercentageOrAuto,
        category: PropertyCategory,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) {
        self.flush_helper_physical(spec, field, val, category, dest, context);
        *self.physical_slot(field) = Some(val.clone());
        self.category = category;
        self.has_any = true;
    }

    fn logical_property_helper(
        &mut self,
        spec: &'static SizeSpec,
        field: LogicalSlot,
        val: Property,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) {
        // Assume unparsed properties might contain unsupported syntax that we must preserve as a fallback.
        if self.category != PropertyCategory::Logical
            || (self.logical_slot_is_some(field) && matches!(val, Property::Unparsed(_)))
        {
            self.flush(spec, dest, context);
        }

        // Assigning over the Option drops the old value.
        *self.logical_slot(field) = Some(val);
        self.category = PropertyCategory::Logical;
        self.has_any = true;
    }

    fn flush(
        &mut self,
        spec: &'static SizeSpec,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) {
        if !self.has_any {
            return;
        }

        self.has_any = false;

        let top = self.top.take();
        let bottom = self.bottom.take();
        let left = self.left.take();
        let right = self.right.take();
        let logical_supported = match spec.feature {
            Some(feature) => !context.should_compile_logical(feature),
            None => true,
        };

        match (top, bottom, left, right) {
            (Some(top), Some(bottom), Some(left), Some(right))
                if spec.shorthand_category != PropertyCategory::Logical || logical_supported =>
            {
                dest.push((spec.make_shorthand)(top, bottom, left, right));
            }
            (top, bottom, left, right) => {
                if let Some(t) = top {
                    dest.push((spec.make_top)(t));
                }
                if let Some(b) = bottom {
                    dest.push((spec.make_bottom)(b));
                }
                if let Some(b) = left {
                    dest.push((spec.make_left)(b));
                }
                if let Some(b) = right {
                    dest.push((spec.make_right)(b));
                }
            }
        }

        let mut block_start = self.block_start.take();
        let mut block_end = self.block_end.take();
        let mut inline_start = self.inline_start.take();
        let mut inline_end = self.inline_end.take();

        if logical_supported {
            Self::logical_side_helper(
                spec,
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
                spec.block_start,
                spec.extract_block_start,
                spec.make_top,
                spec.top_id,
                dest,
                context,
            );
            Self::prop(
                &mut block_end,
                spec.block_end,
                spec.extract_block_end,
                spec.make_bottom,
                spec.bottom_id,
                dest,
                context,
            );
        }

        if logical_supported {
            Self::logical_side_helper(
                spec,
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
                .map(|p| p.variant_tag() == spec.inline_start)
                .unwrap_or(false);
            let end_matches = inline_end
                .as_ref()
                .map(|p| p.variant_tag() == spec.inline_end)
                .unwrap_or(false);
            let values_equal = if start_matches && end_matches {
                (spec.extract_inline_start)(inline_start.as_ref().unwrap())
                    == (spec.extract_inline_end)(inline_end.as_ref().unwrap())
            } else {
                false
            };

            if start_matches && end_matches && values_equal {
                Self::prop(
                    &mut inline_start,
                    spec.inline_start,
                    spec.extract_inline_start,
                    spec.make_left,
                    spec.left_id,
                    dest,
                    context,
                );
                Self::prop(
                    &mut inline_end,
                    spec.inline_end,
                    spec.extract_inline_end,
                    spec.make_right,
                    spec.right_id,
                    dest,
                    context,
                );
            } else {
                Self::logical_prop_helper(
                    &mut inline_start,
                    spec.inline_start,
                    spec.extract_inline_start,
                    spec.make_left,
                    spec.left_id,
                    spec.make_right,
                    spec.right_id,
                    dest,
                    context,
                );
                Self::logical_prop_helper(
                    &mut inline_end,
                    spec.inline_end,
                    spec.extract_inline_end,
                    spec.make_right,
                    spec.right_id,
                    spec.make_left,
                    spec.left_id,
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
        spec: &'static SizeSpec,
        start: &mut Option<Property>,
        end: &mut Option<Property>,
        pair: LogicalSidePair,
        logical_supported: bool,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) {
        // _ = this; // autofix
        let shorthand_supported = logical_supported
            && match spec.shorthand_feature {
                Some(f) => !context.should_compile_logical(f),
                None => true,
            };

        let (start_prop, end_prop) = match pair {
            LogicalSidePair::Block => (spec.block_start, spec.block_end),
            LogicalSidePair::Inline => (spec.inline_start, spec.inline_end),
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
                LogicalSidePair::Block => {
                    (spec.extract_block_start)(start.as_ref().unwrap()).clone()
                }
                LogicalSidePair::Inline => {
                    (spec.extract_inline_start)(start.as_ref().unwrap()).clone()
                }
            };
            let end_v = match pair {
                LogicalSidePair::Block => (spec.extract_block_end)(end.as_ref().unwrap()).clone(),
                LogicalSidePair::Inline => (spec.extract_inline_end)(end.as_ref().unwrap()).clone(),
            };
            let prop = match pair {
                LogicalSidePair::Block => (spec.make_block_shorthand)(start_v, end_v),
                LogicalSidePair::Inline => (spec.make_inline_shorthand)(start_v, end_v),
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

macro_rules! size_handler_spec {
    (
        $Top:ident, $Bottom:ident, $Left:ident, $Right:ident,
        $BlockStart:ident, $BlockEnd:ident, $InlineStart:ident, $InlineEnd:ident,
        $Shorthand:ident, $BlockShorthand:ident, $InlineShorthand:ident,
        category: $category:expr, feature: $feature:expr, shorthand_feature: $shorthand_feature:expr
    ) => {
        const SPEC: &'static SizeSpec = &SizeSpec {
            top: PropertyIdTag::$Top,
            bottom: PropertyIdTag::$Bottom,
            left: PropertyIdTag::$Left,
            right: PropertyIdTag::$Right,
            block_start: PropertyIdTag::$BlockStart,
            block_end: PropertyIdTag::$BlockEnd,
            inline_start: PropertyIdTag::$InlineStart,
            inline_end: PropertyIdTag::$InlineEnd,
            shorthand: PropertyIdTag::$Shorthand,
            block_shorthand: PropertyIdTag::$BlockShorthand,
            inline_shorthand: PropertyIdTag::$InlineShorthand,
            top_id: PropertyId::$Top,
            bottom_id: PropertyId::$Bottom,
            left_id: PropertyId::$Left,
            right_id: PropertyId::$Right,
            shorthand_category: $category,
            feature: $feature,
            shorthand_feature: $shorthand_feature,
            extract_top: |p| match p {
                Property::$Top(v) => v,
                _ => unreachable!(),
            },
            extract_bottom: |p| match p {
                Property::$Bottom(v) => v,
                _ => unreachable!(),
            },
            extract_left: |p| match p {
                Property::$Left(v) => v,
                _ => unreachable!(),
            },
            extract_right: |p| match p {
                Property::$Right(v) => v,
                _ => unreachable!(),
            },
            extract_block_start: |p| match p {
                Property::$BlockStart(v) => v,
                _ => unreachable!(),
            },
            extract_block_end: |p| match p {
                Property::$BlockEnd(v) => v,
                _ => unreachable!(),
            },
            extract_inline_start: |p| match p {
                Property::$InlineStart(v) => v,
                _ => unreachable!(),
            },
            extract_inline_end: |p| match p {
                Property::$InlineEnd(v) => v,
                _ => unreachable!(),
            },
            extract_shorthand: |p| match p {
                Property::$Shorthand(v) => [&v.top, &v.right, &v.bottom, &v.left],
                _ => unreachable!(),
            },
            extract_block_shorthand: |p| match p {
                Property::$BlockShorthand(v) => [&v.block_start, &v.block_end],
                _ => unreachable!(),
            },
            extract_inline_shorthand: |p| match p {
                Property::$InlineShorthand(v) => [&v.inline_start, &v.inline_end],
                _ => unreachable!(),
            },
            make_top: Property::$Top,
            make_bottom: Property::$Bottom,
            make_left: Property::$Left,
            make_right: Property::$Right,
            make_block_start: Property::$BlockStart,
            make_block_end: Property::$BlockEnd,
            make_inline_start: Property::$InlineStart,
            make_inline_end: Property::$InlineEnd,
            make_shorthand: |top, bottom, left, right| {
                Property::$Shorthand($Shorthand {
                    top,
                    right,
                    bottom,
                    left,
                })
            },
            make_block_shorthand: |block_start, block_end| {
                Property::$BlockShorthand($BlockShorthand {
                    block_start,
                    block_end,
                })
            },
            make_inline_shorthand: |inline_start, inline_end| {
                Property::$InlineShorthand($InlineShorthand {
                    inline_start,
                    inline_end,
                })
            },
        };
    };
}

pub struct MarginSpec;
impl SizeHandlerSpec for MarginSpec {
    size_handler_spec!(
        MarginTop, MarginBottom, MarginLeft, MarginRight,
        MarginBlockStart, MarginBlockEnd, MarginInlineStart, MarginInlineEnd,
        Margin, MarginBlock, MarginInline,
        category: PropertyCategory::Physical, feature: Some(Feature::LogicalMargin), shorthand_feature: Some(Feature::LogicalMarginShorthand)
    );
}

pub struct PaddingSpec;
impl SizeHandlerSpec for PaddingSpec {
    size_handler_spec!(
        PaddingTop, PaddingBottom, PaddingLeft, PaddingRight,
        PaddingBlockStart, PaddingBlockEnd, PaddingInlineStart, PaddingInlineEnd,
        Padding, PaddingBlock, PaddingInline,
        category: PropertyCategory::Physical, feature: Some(Feature::LogicalPadding), shorthand_feature: Some(Feature::LogicalPaddingShorthand)
    );
}

pub struct ScrollMarginSpec;
impl SizeHandlerSpec for ScrollMarginSpec {
    size_handler_spec!(
        ScrollMarginTop, ScrollMarginBottom, ScrollMarginLeft, ScrollMarginRight,
        ScrollMarginBlockStart, ScrollMarginBlockEnd, ScrollMarginInlineStart, ScrollMarginInlineEnd,
        ScrollMargin, ScrollMarginBlock, ScrollMarginInline,
        category: PropertyCategory::Physical, feature: None, shorthand_feature: None
    );
}

pub struct InsetSpec;
impl SizeHandlerSpec for InsetSpec {
    size_handler_spec!(
        Top, Bottom, Left, Right,
        InsetBlockStart, InsetBlockEnd, InsetInlineStart, InsetInlineEnd,
        Inset, InsetBlock, InsetInline,
        category: PropertyCategory::Physical, feature: Some(Feature::LogicalInset), shorthand_feature: Some(Feature::LogicalInset)
    );
}

// NOTE: `ScrollPadding{,Block,Inline}` value types are defined above but no
// `ScrollPaddingHandler` is instantiated.
