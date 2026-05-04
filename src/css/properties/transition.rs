use bun_css::SmallList;
use bun_css::Printer;
use bun_css::PrintErr;
use bun_css::Parser;
use bun_css::Result as CssResult;
use bun_css::DeclarationList;
use bun_css::PropertyHandlerContext;
use bun_css::PropertyIdTag;

use bun_css::css_properties::Property;
use bun_css::css_properties::PropertyId;
use bun_css::css_properties::masking;
use bun_css::css_values::time::Time;
use bun_css::css_values::easing::EasingFunction;

use bun_css::VendorPrefix;
use bun_css::prefixes::Feature;
use bun_css::compat;

/// A value for the [transition](https://www.w3.org/TR/2018/WD-css-transitions-1-20181011/#transition-shorthand-property) property.
#[derive(Clone, PartialEq)]
pub struct Transition {
    /// The property to transition.
    pub property: PropertyId,
    /// The duration of the transition.
    pub duration: Time,
    /// The delay before the transition starts.
    pub delay: Time,
    /// The easing function for the transition.
    pub timing_function: EasingFunction,
}

impl Transition {
    // TODO(port): PropertyFieldMap was a Zig comptime anonymous struct mapping
    // field names → PropertyIdTag, consumed by reflection-based shorthand helpers.
    // Replace with a trait impl or const table once the shorthand machinery is ported.
    pub const PROPERTY_FIELD_MAP: &'static [(&'static str, PropertyIdTag)] = &[
        ("property", PropertyIdTag::TransitionProperty),
        ("duration", PropertyIdTag::TransitionDuration),
        ("delay", PropertyIdTag::TransitionDelay),
        ("timing_function", PropertyIdTag::TransitionTimingFunction),
    ];

    pub fn eql(&self, rhs: &Self) -> bool {
        // Zig: css.implementEql(@This(), lhs, rhs) — field-by-field reflection.
        self == rhs
    }

    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // Zig: css.implementDeepClone(@This(), this, allocator) — field-by-field reflection.
        Self {
            property: self.property.deep_clone(bump),
            duration: self.duration.deep_clone(bump),
            delay: self.delay.deep_clone(bump),
            timing_function: self.timing_function.deep_clone(bump),
        }
    }

    pub fn parse(parser: &mut Parser) -> CssResult<Self> {
        let mut property: Option<PropertyId> = None;
        let mut duration: Option<Time> = None;
        let mut delay: Option<Time> = None;
        let mut timing_function: Option<EasingFunction> = None;

        loop {
            if duration.is_none() {
                if let Some(value) = parser.try_parse(Time::parse, ()).as_value() {
                    duration = Some(value);
                    continue;
                }
            }

            if timing_function.is_none() {
                if let Some(value) = parser.try_parse(EasingFunction::parse, ()).as_value() {
                    timing_function = Some(value);
                    continue;
                }
            }

            if delay.is_none() {
                if let Some(value) = parser.try_parse(Time::parse, ()).as_value() {
                    delay = Some(value);
                    continue;
                }
            }

            if property.is_none() {
                if let Some(value) = parser.try_parse(PropertyId::parse, ()).as_value() {
                    property = Some(value);
                    continue;
                }
            }

            break;
        }

        CssResult::result(Self {
            property: property.unwrap_or(PropertyId::All),
            duration: duration.unwrap_or(Time::Seconds(0.0)),
            delay: delay.unwrap_or(Time::Seconds(0.0)),
            timing_function: timing_function.unwrap_or(EasingFunction::Ease),
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        self.property.to_css(dest)?;
        if !self.duration.is_zero() || !self.delay.is_zero() {
            dest.write_char(' ')?;
            self.duration.to_css(dest)?;
        }

        if !self.timing_function.is_ease() {
            dest.write_char(' ')?;
            self.timing_function.to_css(dest)?;
        }

        if !self.delay.is_zero() {
            dest.write_char(' ')?;
            self.delay.to_css(dest)?;
        }
        Ok(())
    }
}

#[derive(Default)]
pub struct TransitionHandler {
    pub properties: Option<(SmallList<PropertyId, 1>, VendorPrefix)>,
    pub durations: Option<(SmallList<Time, 1>, VendorPrefix)>,
    pub delays: Option<(SmallList<Time, 1>, VendorPrefix)>,
    pub timing_functions: Option<(SmallList<EasingFunction, 1>, VendorPrefix)>,
    pub has_any: bool,
}

// PORT NOTE: Zig's `property`/`maybeFlush` took `comptime prop: []const u8` and used
// `@field(this, prop)` + `val: anytype` for comptime field dispatch. Rust has no
// `@field`, and passing both `&mut self` and `&mut self.<field>` to a generic fn
// trips borrowck (because `flush` needs `&mut self`). Macros expand at the call
// site exactly like the Zig comptime dispatch did.
macro_rules! handler_maybe_flush {
    ($this:expr, $dest:expr, $context:expr, $field:ident, $val:expr, $vp:expr) => {{
        // If two vendor prefixes for the same property have different
        // values, we need to flush what we have immediately to preserve order.
        if let Some((v, prefixes)) = &$this.$field {
            if !$val.eql(v) && !prefixes.contains($vp) {
                $this.flush($dest, $context);
            }
        }
    }};
}

macro_rules! handler_property {
    ($this:expr, $dest:expr, $context:expr, $feature:expr, $field:ident, $val:expr, $vp:expr) => {{
        handler_maybe_flush!($this, $dest, $context, $field, $val, $vp);

        // Otherwise, update the value and add the prefix.
        if let Some((v, prefixes)) = &mut $this.$field {
            *v = $val.deep_clone($context.allocator);
            prefixes.insert($vp);
            *prefixes = $context.targets.prefixes(*prefixes, $feature);
        } else {
            let prefixes = $context.targets.prefixes($vp, $feature);
            let cloned_val = $val.deep_clone($context.allocator);
            $this.$field = Some((cloned_val, prefixes));
            $this.has_any = true;
        }
    }};
}

impl TransitionHandler {
    pub fn handle_property(
        &mut self,
        prop: &Property,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) -> bool {
        match prop {
            Property::TransitionProperty(x) => {
                handler_property!(self, dest, context, Feature::TransitionProperty, properties, &x.0, x.1)
            }
            Property::TransitionDuration(x) => {
                handler_property!(self, dest, context, Feature::TransitionDuration, durations, &x.0, x.1)
            }
            Property::TransitionDelay(x) => {
                handler_property!(self, dest, context, Feature::TransitionDelay, delays, &x.0, x.1)
            }
            Property::TransitionTimingFunction(x) => {
                handler_property!(self, dest, context, Feature::TransitionTimingFunction, timing_functions, &x.0, x.1)
            }
            Property::Transition(x) => {
                let val: &SmallList<Transition, 1> = &x.0;
                let vp: VendorPrefix = x.1;

                let mut properties = SmallList::<PropertyId, 1>::init_capacity(context.allocator, val.len());
                let mut durations = SmallList::<Time, 1>::init_capacity(context.allocator, val.len());
                let mut delays = SmallList::<Time, 1>::init_capacity(context.allocator, val.len());
                let mut timing_functions = SmallList::<EasingFunction, 1>::init_capacity(context.allocator, val.len());
                properties.set_len(val.len());
                durations.set_len(val.len());
                delays.set_len(val.len());
                timing_functions.set_len(val.len());

                debug_assert_eq!(val.slice().len(), properties.slice_mut().len());
                for (item, out_prop) in val.slice().iter().zip(properties.slice_mut()) {
                    *out_prop = item.property.deep_clone(context.allocator);
                }
                handler_maybe_flush!(self, dest, context, properties, &properties, vp);

                debug_assert_eq!(val.slice().len(), durations.slice_mut().len());
                for (item, out_dur) in val.slice().iter().zip(durations.slice_mut()) {
                    *out_dur = item.duration.deep_clone(context.allocator);
                }
                handler_maybe_flush!(self, dest, context, durations, &durations, vp);

                debug_assert_eq!(val.slice().len(), delays.slice_mut().len());
                for (item, out_delay) in val.slice().iter().zip(delays.slice_mut()) {
                    *out_delay = item.delay.deep_clone(context.allocator);
                }
                handler_maybe_flush!(self, dest, context, delays, &delays, vp);

                debug_assert_eq!(val.slice().len(), timing_functions.slice_mut().len());
                for (item, out_timing) in val.slice().iter().zip(timing_functions.slice_mut()) {
                    *out_timing = item.timing_function.deep_clone(context.allocator);
                }
                handler_maybe_flush!(self, dest, context, timing_functions, &timing_functions, vp);

                handler_property!(self, dest, context, Feature::TransitionProperty, properties, &properties, vp);
                handler_property!(self, dest, context, Feature::TransitionDuration, durations, &durations, vp);
                handler_property!(self, dest, context, Feature::TransitionDelay, delays, &delays, vp);
                handler_property!(self, dest, context, Feature::TransitionTimingFunction, timing_functions, &timing_functions, vp);
            }
            Property::Unparsed(x) => {
                if is_transition_property(&x.property_id) {
                    self.flush(dest, context);
                    dest.push(Property::Unparsed(
                        x.get_prefixed(context.allocator, context.targets, Feature::Transition),
                    ));
                } else {
                    return false;
                }
            }
            _ => return false,
        }

        true
    }

    pub fn finalize(&mut self, dest: &mut DeclarationList, context: &mut PropertyHandlerContext) {
        self.flush(dest, context);
    }

    fn flush(&mut self, dest: &mut DeclarationList, context: &mut PropertyHandlerContext) {
        if !self.has_any {
            return;
        }
        self.has_any = false;

        let mut _properties: Option<(SmallList<PropertyId, 1>, VendorPrefix)> = self.properties.take();
        let mut _durations: Option<(SmallList<Time, 1>, VendorPrefix)> = self.durations.take();
        let mut _delays: Option<(SmallList<Time, 1>, VendorPrefix)> = self.delays.take();
        let mut _timing_functions: Option<(SmallList<EasingFunction, 1>, VendorPrefix)> = self.timing_functions.take();

        let mut rtl_properties: Option<SmallList<PropertyId, 1>> =
            if let Some(p) = &mut _properties { expand_properties(&mut p.0, context) } else { None };

        if _properties.is_some() && _durations.is_some() && _delays.is_some() && _timing_functions.is_some() {
            // PORT NOTE: reshaped for borrowck — Zig held simultaneous &mut to all four
            // Option payloads via `.?`. Rust requires unwrapping each Option mutably.
            let (properties, property_prefixes) = _properties.as_mut().unwrap();
            let (durations, duration_prefixes) = _durations.as_mut().unwrap();
            let (delays, delay_prefixes) = _delays.as_mut().unwrap();
            let (timing_functions, timing_prefixes) = _timing_functions.as_mut().unwrap();

            // Find the intersection of prefixes with the same value.
            // Remove that from the prefixes of each of the properties. The remaining
            // prefixes will be handled by outputting individual properties below.
            let intersection = property_prefixes
                .bitwise_and(*duration_prefixes)
                .bitwise_and(*delay_prefixes)
                .bitwise_and(*timing_prefixes);
            if !intersection.is_empty() {
                let transitions = get_transitions(context, properties, durations, delays, timing_functions);

                if let Some(rtl_properties2) = &mut rtl_properties {
                    let rtl_transitions = get_transitions(context, rtl_properties2, durations, delays, timing_functions);
                    context.add_logical_rule(
                        context.allocator,
                        Property::Transition((transitions, intersection)),
                        Property::Transition((rtl_transitions, intersection)),
                    );
                } else {
                    dest.push(Property::Transition((
                        transitions.deep_clone(context.allocator),
                        intersection,
                    )));
                }

                property_prefixes.remove(intersection);
                duration_prefixes.remove(intersection);
                timing_prefixes.remove(intersection);
                delay_prefixes.remove(intersection);
            }
        }

        if let Some((properties, prefix)) = _properties.take() {
            if !prefix.is_empty() {
                if let Some(rtl_properties2) = rtl_properties.take() {
                    context.add_logical_rule(
                        context.allocator,
                        Property::TransitionProperty((properties, prefix)),
                        Property::TransitionProperty((rtl_properties2, prefix)),
                    );
                } else {
                    dest.push(Property::TransitionProperty((properties, prefix)));
                }
            }
        }

        if let Some((durations, prefix)) = _durations.take() {
            if !prefix.is_empty() {
                dest.push(Property::TransitionDuration((durations, prefix)));
            }
        }

        if let Some((delays, prefix)) = _delays.take() {
            if !prefix.is_empty() {
                dest.push(Property::TransitionDelay((delays, prefix)));
            }
        }

        if let Some((timing_functions, prefix)) = _timing_functions.take() {
            if !prefix.is_empty() {
                dest.push(Property::TransitionTimingFunction((timing_functions, prefix)));
            }
        }

        self.reset();
    }

    pub fn reset(&mut self) {
        self.properties = None;
        self.durations = None;
        self.delays = None;
        self.timing_functions = None;
        self.has_any = false;
    }
}

#[inline]
fn get_transitions(
    context: &PropertyHandlerContext,
    properties: &mut SmallList<PropertyId, 1>,
    durations: &mut SmallList<Time, 1>,
    delays: &mut SmallList<Time, 1>,
    timing_functions: &mut SmallList<EasingFunction, 1>,
) -> SmallList<Transition, 1> {
    #[inline]
    fn cycle_bump(idx: &mut u32, len: u32) {
        *idx = (*idx + 1) % len;
    }

    // transition-property determines the number of transitions. The values of other
    // properties are repeated to match this length.
    let mut transitions = SmallList::<Transition, 1>::init_capacity(context.allocator, 1);
    let mut durations_idx: u32 = 0;
    let mut delays_idx: u32 = 0;
    let mut timing_idx: u32 = 0;
    for property_id in properties.slice() {
        let duration = if durations.len() > durations_idx {
            durations.at(durations_idx).deep_clone(context.allocator)
        } else {
            Time::Seconds(0.0)
        };
        let delay = if delays.len() > delays_idx {
            delays.at(delays_idx).deep_clone(context.allocator)
        } else {
            Time::Seconds(0.0)
        };
        let timing_function = if timing_functions.len() > timing_idx {
            timing_functions.at(timing_idx).deep_clone(context.allocator)
        } else {
            EasingFunction::Ease
        };
        cycle_bump(&mut durations_idx, durations.len());
        cycle_bump(&mut delays_idx, delays.len());
        cycle_bump(&mut timing_idx, timing_functions.len());
        let transition = Transition {
            property: property_id.deep_clone(context.allocator),
            duration,
            delay,
            timing_function,
        };
        let mut cloned = false;

        let prefix_to_iter = property_id.prefix().or_none();
        // Expand vendor prefixes into multiple transitions.
        // PORT NOTE: Zig used `inline for (VendorPrefix.FIELDS)` over packed-struct
        // bool fields. With bitflags, iterate the individual flag bits.
        // PERF(port): was comptime-unrolled inline-for — profile in Phase B.
        for prefix_field in VendorPrefix::FIELDS {
            if prefix_to_iter.contains(prefix_field) {
                let mut t = if cloned {
                    transition.deep_clone(context.allocator)
                } else {
                    // TODO(port): Zig moved `transition` here on first iteration; Rust
                    // can't move out of a value that may be reused next iteration.
                    // Clone unconditionally for now.
                    transition.deep_clone(context.allocator)
                };
                cloned = true;
                let new_prefix = prefix_field;
                t.property = property_id.with_prefix(new_prefix);
                transitions.append(context.allocator, t);
            }
        }
        let _ = cloned;
    }
    transitions
}

fn expand_properties(
    properties: &mut SmallList<PropertyId, 1>,
    context: &mut PropertyHandlerContext,
) -> Option<SmallList<PropertyId, 1>> {
    #[inline]
    fn replace(
        allocator: &bun_alloc::Arena,
        propertiez: &mut SmallList<PropertyId, 1>,
        props: &[PropertyId],
        i: u32,
    ) {
        *propertiez.mut_(i) = props[0].deep_clone(allocator);
        if props.len() > 1 {
            propertiez.insert_slice(allocator, i + 1, &props[1..]);
        }
    }

    let mut rtl_properties: Option<SmallList<PropertyId, 1>> = None;
    let mut i: u32 = 0;

    // Expand logical properties in place.
    while i < properties.len() {
        let result = get_logical_properties(properties.at(i));
        match result {
            LogicalPropertyId::Block(feature, block) if context.should_compile_logical(feature) => {
                replace(context.allocator, properties, block, i);
                if let Some(rtl) = &mut rtl_properties {
                    replace(context.allocator, rtl, block, i);
                }
                i += 1;
            }
            LogicalPropertyId::Inline(feature, ltr, rtl) if context.should_compile_logical(feature) => {
                // Clone properties to create RTL version only when needed.
                if rtl_properties.is_none() {
                    rtl_properties = Some(properties.deep_clone(context.allocator));
                }

                replace(context.allocator, properties, ltr, i);
                if let Some(rtl_props) = &mut rtl_properties {
                    replace(context.allocator, rtl_props, rtl, i);
                }

                i += u32::try_from(ltr.len()).unwrap();
            }
            _ => {
                // Expand vendor prefixes for targets.
                properties.mut_(i).set_prefixes_for_targets(context.targets);

                // Expand mask properties, which use different vendor-prefixed names.
                if let Some(property_id) = masking::get_webkit_mask_property(properties.at(i)) {
                    if context.targets.prefixes(VendorPrefix::NONE, Feature::MaskBorder).webkit() {
                        properties.insert(context.allocator, i, property_id);
                        i += 1;
                    }
                }

                if let Some(rtl_props) = &mut rtl_properties {
                    rtl_props.mut_(i).set_prefixes_for_targets(context.targets);

                    if let Some(property_id) = masking::get_webkit_mask_property(rtl_props.at(i)) {
                        if context.targets.prefixes(VendorPrefix::NONE, Feature::MaskBorder).webkit() {
                            rtl_props.insert(context.allocator, i, property_id);
                            i += 1;
                        }
                    }
                }
                i += 1;
            }
        }
    }

    rtl_properties
}

enum LogicalPropertyId {
    None,
    Block(compat::Feature, &'static [PropertyId]),
    Inline(compat::Feature, &'static [PropertyId], &'static [PropertyId]),
}

fn get_logical_properties(property_id: &PropertyId) -> LogicalPropertyId {
    use compat::Feature as F;
    use LogicalPropertyId::{Block, Inline};
    // TODO(port): PropertyId variant names assumed PascalCase from Zig kebab-case
    // (e.g. `.@"block-size"` → `BlockSize`). Adjust to actual generated names in Phase B.
    match property_id {
        PropertyId::BlockSize => Block(F::LogicalSize, &[PropertyId::Height]),
        PropertyId::InlineSize => Inline(F::LogicalSize, &[PropertyId::Width], &[PropertyId::Height]),
        PropertyId::MinBlockSize => Block(F::LogicalSize, &[PropertyId::MinHeight]),
        PropertyId::MaxBlockSize => Block(F::LogicalSize, &[PropertyId::MaxHeight]),
        PropertyId::MinInlineSize => Inline(F::LogicalSize, &[PropertyId::MinWidth], &[PropertyId::MinHeight]),
        PropertyId::MaxInlineSize => Inline(F::LogicalSize, &[PropertyId::MaxWidth], &[PropertyId::MaxHeight]),

        PropertyId::InsetBlockStart => Block(F::LogicalInset, &[PropertyId::Top]),
        PropertyId::InsetBlockEnd => Block(F::LogicalInset, &[PropertyId::Bottom]),
        PropertyId::InsetInlineStart => Inline(F::LogicalInset, &[PropertyId::Left], &[PropertyId::Right]),
        PropertyId::InsetInlineEnd => Inline(F::LogicalInset, &[PropertyId::Right], &[PropertyId::Left]),
        PropertyId::InsetBlock => Block(F::LogicalInset, &[PropertyId::Top, PropertyId::Bottom]),
        PropertyId::InsetInline => Block(F::LogicalInset, &[PropertyId::Left, PropertyId::Right]),
        PropertyId::Inset => Block(F::LogicalInset, &[PropertyId::Top, PropertyId::Bottom, PropertyId::Left, PropertyId::Right]),

        PropertyId::MarginBlockStart => Block(F::LogicalMargin, &[PropertyId::MarginTop]),
        PropertyId::MarginBlockEnd => Block(F::LogicalMargin, &[PropertyId::MarginBottom]),
        PropertyId::MarginInlineStart => Inline(F::LogicalMargin, &[PropertyId::MarginLeft], &[PropertyId::MarginRight]),
        PropertyId::MarginInlineEnd => Inline(F::LogicalMargin, &[PropertyId::MarginRight], &[PropertyId::MarginLeft]),
        PropertyId::MarginBlock => Block(F::LogicalMargin, &[PropertyId::MarginTop, PropertyId::MarginBottom]),
        PropertyId::MarginInline => Block(F::LogicalMargin, &[PropertyId::MarginLeft, PropertyId::MarginRight]),

        PropertyId::PaddingBlockStart => Block(F::LogicalPadding, &[PropertyId::PaddingTop]),
        PropertyId::PaddingBlockEnd => Block(F::LogicalPadding, &[PropertyId::PaddingBottom]),
        PropertyId::PaddingInlineStart => Inline(F::LogicalPadding, &[PropertyId::PaddingLeft], &[PropertyId::PaddingRight]),
        PropertyId::PaddingInlineEnd => Inline(F::LogicalPadding, &[PropertyId::PaddingRight], &[PropertyId::PaddingLeft]),
        PropertyId::PaddingBlock => Block(F::LogicalPadding, &[PropertyId::PaddingTop, PropertyId::PaddingBottom]),
        PropertyId::PaddingInline => Block(F::LogicalPadding, &[PropertyId::PaddingLeft, PropertyId::PaddingRight]),

        PropertyId::BorderBlockStart => Block(F::LogicalBorders, &[PropertyId::BorderTop]),
        PropertyId::BorderBlockStartWidth => Block(F::LogicalBorders, &[PropertyId::BorderTopWidth]),
        PropertyId::BorderBlockStartColor => Block(F::LogicalBorders, &[PropertyId::BorderTopColor]),
        PropertyId::BorderBlockStartStyle => Block(F::LogicalBorders, &[PropertyId::BorderTopStyle]),

        PropertyId::BorderBlockEnd => Block(F::LogicalBorders, &[PropertyId::BorderBottom]),
        PropertyId::BorderBlockEndWidth => Block(F::LogicalBorders, &[PropertyId::BorderBottomWidth]),
        PropertyId::BorderBlockEndColor => Block(F::LogicalBorders, &[PropertyId::BorderBottomColor]),
        PropertyId::BorderBlockEndStyle => Block(F::LogicalBorders, &[PropertyId::BorderBottomStyle]),

        PropertyId::BorderInlineStart => Inline(F::LogicalBorders, &[PropertyId::BorderLeft], &[PropertyId::BorderRight]),
        PropertyId::BorderInlineStartWidth => Inline(F::LogicalBorders, &[PropertyId::BorderLeftWidth], &[PropertyId::BorderRightWidth]),
        PropertyId::BorderInlineStartColor => Inline(F::LogicalBorders, &[PropertyId::BorderLeftColor], &[PropertyId::BorderRightColor]),
        PropertyId::BorderInlineStartStyle => Inline(F::LogicalBorders, &[PropertyId::BorderLeftStyle], &[PropertyId::BorderRightStyle]),

        PropertyId::BorderInlineEnd => Inline(F::LogicalBorders, &[PropertyId::BorderRight], &[PropertyId::BorderLeft]),
        PropertyId::BorderInlineEndWidth => Inline(F::LogicalBorders, &[PropertyId::BorderRightWidth], &[PropertyId::BorderLeftWidth]),
        PropertyId::BorderInlineEndColor => Inline(F::LogicalBorders, &[PropertyId::BorderRightColor], &[PropertyId::BorderLeftColor]),
        PropertyId::BorderInlineEndStyle => Inline(F::LogicalBorders, &[PropertyId::BorderRightStyle], &[PropertyId::BorderLeftStyle]),

        PropertyId::BorderBlock => Block(F::LogicalBorders, &[PropertyId::BorderTop, PropertyId::BorderBottom]),
        PropertyId::BorderBlockColor => Block(F::LogicalBorders, &[PropertyId::BorderTopColor, PropertyId::BorderBottomColor]),
        PropertyId::BorderBlockWidth => Block(F::LogicalBorders, &[PropertyId::BorderTopWidth, PropertyId::BorderBottomWidth]),
        PropertyId::BorderBlockStyle => Block(F::LogicalBorders, &[PropertyId::BorderTopStyle, PropertyId::BorderBottomStyle]),

        PropertyId::BorderInline => Block(F::LogicalBorders, &[PropertyId::BorderLeft, PropertyId::BorderRight]),
        PropertyId::BorderInlineColor => Block(F::LogicalBorders, &[PropertyId::BorderLeftColor, PropertyId::BorderRightColor]),
        PropertyId::BorderInlineWidth => Block(F::LogicalBorders, &[PropertyId::BorderLeftWidth, PropertyId::BorderRightWidth]),
        PropertyId::BorderInlineStyle => Block(F::LogicalBorders, &[PropertyId::BorderLeftStyle, PropertyId::BorderRightStyle]),

        PropertyId::BorderStartStartRadius => Inline(
            F::LogicalBorders,
            &[PropertyId::BorderTopLeftRadius(VendorPrefix::NONE)],
            &[PropertyId::BorderTopRightRadius(VendorPrefix::NONE)],
        ),
        PropertyId::BorderStartEndRadius => Inline(
            F::LogicalBorders,
            &[PropertyId::BorderTopRightRadius(VendorPrefix::NONE)],
            &[PropertyId::BorderTopLeftRadius(VendorPrefix::NONE)],
        ),
        PropertyId::BorderEndStartRadius => Inline(
            F::LogicalBorders,
            &[PropertyId::BorderBottomLeftRadius(VendorPrefix::NONE)],
            &[PropertyId::BorderBottomRightRadius(VendorPrefix::NONE)],
        ),
        PropertyId::BorderEndEndRadius => Inline(
            F::LogicalBorders,
            &[PropertyId::BorderBottomRightRadius(VendorPrefix::NONE)],
            &[PropertyId::BorderBottomLeftRadius(VendorPrefix::NONE)],
        ),

        _ => LogicalPropertyId::None,
    }
}

fn is_transition_property(property_id: &PropertyId) -> bool {
    matches!(
        property_id,
        PropertyId::TransitionProperty(..)
            | PropertyId::TransitionDuration(..)
            | PropertyId::TransitionDelay(..)
            | PropertyId::TransitionTimingFunction(..)
            | PropertyId::Transition(..)
    )
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/properties/transition.zig (519 lines)
//   confidence: medium
//   todos:      3
//   notes:      @field comptime dispatch → macros; PropertyId variant names guessed (kebab→PascalCase); VendorPrefix::FIELDS iteration assumes bitflags-style API
// ──────────────────────────────────────────────────────────────────────────
