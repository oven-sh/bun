#![warn(unused_must_use)]
use crate::DeclarationList;
use crate::Parser;
use crate::PrintErr;
use crate::Printer;
use crate::PropertyHandlerContext;
use crate::Result as CssResult;
use crate::SmallList;
use bun_alloc::ArenaVecExt as _;

use crate::css_properties::Property;
use crate::css_properties::PropertyId;
use crate::css_properties::masking;
use crate::css_values::easing::EasingFunction;
use crate::css_values::ident::CustomIdent;
use crate::css_values::time::Time;

use crate::VendorPrefix;
use crate::compat;
use crate::prefixes::Feature;

/// A value for the [transition](https://www.w3.org/TR/2018/WD-css-transitions-1-20181011/#transition-shorthand-property) property.
#[derive(Clone, PartialEq)]
pub struct Transition {
    /// The property to transition.
    pub(crate) property: PropertyId,
    /// The duration of the transition.
    pub(crate) duration: Time,
    /// The delay before the transition starts.
    pub(crate) delay: Time,
    /// The easing function for the transition.
    pub(crate) timing_function: EasingFunction,
}

impl Transition {
    pub(crate) fn eql(&self, rhs: &Self) -> bool {
        self == rhs
    }

    pub(crate) fn deep_clone(&self, _bump: &bun_alloc::Arena) -> Self {
        // All four fields deep-clone via `#[derive(Clone)]` with no
        // arena indirections (any heap-carrying variants of `PropertyId`/
        // `EasingFunction` clone deeply onto the global heap), so Clone is exact.
        self.clone()
    }

    pub(crate) fn parse(parser: &mut Parser) -> CssResult<Self> {
        let mut property: Option<PropertyId> = None;
        let mut duration: Option<Time> = None;
        let mut delay: Option<Time> = None;
        let mut timing_function: Option<EasingFunction> = None;

        loop {
            if duration.is_none() {
                if let Ok(value) = parser.try_parse(Time::parse) {
                    duration = Some(value);
                    continue;
                }
            }

            if timing_function.is_none() {
                if let Ok(value) = parser.try_parse(EasingFunction::parse) {
                    timing_function = Some(value);
                    continue;
                }
            }

            if delay.is_none() {
                if let Ok(value) = parser.try_parse(Time::parse) {
                    delay = Some(value);
                    continue;
                }
            }

            if property.is_none() {
                if let Ok(value) = parser.try_parse(PropertyId::parse) {
                    property = Some(value);
                    continue;
                }
            }

            break;
        }

        Ok(Self {
            property: property.unwrap_or(PropertyId::All),
            duration: duration.unwrap_or(Time::Seconds(0.0)),
            delay: delay.unwrap_or(Time::Seconds(0.0)),
            timing_function: timing_function.unwrap_or(EasingFunction::Ease),
        })
    }

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        self.property.to_css(dest)?;
        if !self.duration.is_zero() || !self.delay.is_zero() {
            dest.write_char(b' ')?;
            self.duration.to_css(dest)?;
        }

        if !self.timing_function.is_ease() {
            dest.write_char(b' ')?;
            self.timing_function.to_css(dest)?;
        }

        if !self.delay.is_zero() {
            dest.write_char(b' ')?;
            self.delay.to_css(dest)?;
        }
        Ok(())
    }
}

/// A value for the [view-transition-name](https://drafts.csswg.org/css-view-transitions-1/#view-transition-name-prop) property.
///
/// Under CSS modules the `<custom-ident>` is scoped with the same hash as the
/// `::view-transition-*(<name>)` pseudo-element selectors, so the two keep
/// matching after renaming.
#[derive(Clone, Copy, crate::Parse, crate::ToCss, crate::CssEql, crate::DeepClone)]
pub enum ViewTransitionName {
    /// The `none` keyword.
    None,
    /// The `auto` keyword.
    Auto,
    /// The `match-element` keyword.
    MatchElement,
    /// A custom name.
    Custom(CustomIdent),
}

/// A value for the [view-transition-group](https://drafts.csswg.org/css-view-transitions-2/#view-transition-group-prop) property.
#[derive(Clone, Copy, crate::Parse, crate::ToCss, crate::CssEql, crate::DeepClone)]
pub enum ViewTransitionGroup {
    /// The `normal` keyword.
    Normal,
    /// The `contain` keyword.
    Contain,
    /// The `nearest` keyword.
    Nearest,
    /// A custom group, the `view-transition-name` of an ancestor.
    Custom(CustomIdent),
}

#[derive(Default)]
pub struct TransitionHandler {
    pub(crate) properties: Option<(SmallList<PropertyId, 1>, VendorPrefix)>,
    pub(crate) durations: Option<(SmallList<Time, 1>, VendorPrefix)>,
    pub(crate) delays: Option<(SmallList<Time, 1>, VendorPrefix)>,
    pub(crate) timing_functions: Option<(SmallList<EasingFunction, 1>, VendorPrefix)>,
    pub(crate) has_any: bool,
}

// Passing both `&mut self` and `&mut self.<field>` to a generic fn trips
// borrowck (because `flush` needs `&mut self`), so macros expand the field
// dispatch at the call site instead.
macro_rules! handler_maybe_flush {
    ($this:expr, $dest:expr, $context:expr, $field:ident, $val:expr, $vp:expr) => {{
        // If two vendor prefixes for the same property have different
        // values, we need to flush what we have immediately to preserve order.
        if let Some((v, prefixes)) = &$this.$field {
            if !SmallList::eql($val, v) && !prefixes.contains($vp) {
                $this.flush($dest, $context);
            }
        }
    }};
}

macro_rules! handler_property {
    ($this:expr, $dest:expr, $context:expr, $arena:expr, $feature:expr, $field:ident, $val:expr, $vp:expr) => {{
        handler_maybe_flush!($this, $dest, $context, $field, $val, $vp);

        // Otherwise, update the value and add the prefix.
        if let Some((v, prefixes)) = &mut $this.$field {
            *v = $val.deep_clone($arena);
            prefixes.insert($vp);
            *prefixes = $context.targets.prefixes(*prefixes, $feature);
        } else {
            let prefixes = $context.targets.prefixes($vp, $feature);
            let cloned_val = $val.deep_clone($arena);
            $this.$field = Some((cloned_val, prefixes));
            $this.has_any = true;
        }
    }};
}

// Real `handle_property`/`finalize` bodies live in `transition_handler_body` below.
mod transition_handler_body {
    use super::*;
    use crate::generics::CssEql as _;
    use crate::generics::DeepClone;
    impl TransitionHandler {
        pub(crate) fn handle_property(
            &mut self,
            prop: &Property,
            dest: &mut DeclarationList,
            context: &mut PropertyHandlerContext,
        ) -> bool {
            // PropertyHandlerContext carries no arena; it is recovered via
            // `dest.bump()` (DeclarationList = bumpalo::Vec).
            let arena = dest.bump();
            match prop {
                Property::TransitionProperty(x) => {
                    handler_property!(
                        self,
                        dest,
                        context,
                        arena,
                        Feature::TransitionProperty,
                        properties,
                        &x.0,
                        x.1
                    )
                }
                Property::TransitionDuration(x) => {
                    handler_property!(
                        self,
                        dest,
                        context,
                        arena,
                        Feature::TransitionDuration,
                        durations,
                        &x.0,
                        x.1
                    )
                }
                Property::TransitionDelay(x) => {
                    handler_property!(
                        self,
                        dest,
                        context,
                        arena,
                        Feature::TransitionDelay,
                        delays,
                        &x.0,
                        x.1
                    )
                }
                Property::TransitionTimingFunction(x) => {
                    handler_property!(
                        self,
                        dest,
                        context,
                        arena,
                        Feature::TransitionTimingFunction,
                        timing_functions,
                        &x.0,
                        x.1
                    )
                }
                Property::Transition(x) => {
                    let val: &SmallList<Transition, 1> = &x.0;
                    let vp: VendorPrefix = x.1;

                    let mut properties = SmallList::<PropertyId, 1>::init_capacity(val.len());
                    let mut durations = SmallList::<Time, 1>::init_capacity(val.len());
                    let mut delays = SmallList::<Time, 1>::init_capacity(val.len());
                    let mut timing_functions =
                        SmallList::<EasingFunction, 1>::init_capacity(val.len());

                    for item in val.slice() {
                        properties.append(item.property.deep_clone(arena));
                    }
                    handler_maybe_flush!(self, dest, context, properties, &properties, vp);

                    for item in val.slice() {
                        durations.append(item.duration.deep_clone(arena));
                    }
                    handler_maybe_flush!(self, dest, context, durations, &durations, vp);

                    for item in val.slice() {
                        delays.append(item.delay.deep_clone(arena));
                    }
                    handler_maybe_flush!(self, dest, context, delays, &delays, vp);

                    for item in val.slice() {
                        timing_functions.append(item.timing_function.deep_clone(arena));
                    }
                    handler_maybe_flush!(
                        self,
                        dest,
                        context,
                        timing_functions,
                        &timing_functions,
                        vp
                    );

                    handler_property!(
                        self,
                        dest,
                        context,
                        arena,
                        Feature::TransitionProperty,
                        properties,
                        &properties,
                        vp
                    );
                    handler_property!(
                        self,
                        dest,
                        context,
                        arena,
                        Feature::TransitionDuration,
                        durations,
                        &durations,
                        vp
                    );
                    handler_property!(
                        self,
                        dest,
                        context,
                        arena,
                        Feature::TransitionDelay,
                        delays,
                        &delays,
                        vp
                    );
                    handler_property!(
                        self,
                        dest,
                        context,
                        arena,
                        Feature::TransitionTimingFunction,
                        timing_functions,
                        &timing_functions,
                        vp
                    );
                }
                Property::Unparsed(x) => {
                    if is_transition_property(&x.property_id) {
                        self.flush(dest, context);
                        dest.push(Property::Unparsed(x.get_prefixed(
                            arena,
                            &context.targets,
                            Feature::Transition,
                        )));
                    } else {
                        return false;
                    }
                }
                _ => return false,
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

        fn flush(&mut self, dest: &mut DeclarationList, context: &mut PropertyHandlerContext) {
            if !self.has_any {
                return;
            }
            self.has_any = false;

            let arena = dest.bump();

            let mut _properties: Option<(SmallList<PropertyId, 1>, VendorPrefix)> =
                self.properties.take();
            let mut _durations: Option<(SmallList<Time, 1>, VendorPrefix)> = self.durations.take();
            let mut _delays: Option<(SmallList<Time, 1>, VendorPrefix)> = self.delays.take();
            let mut _timing_functions: Option<(SmallList<EasingFunction, 1>, VendorPrefix)> =
                self.timing_functions.take();

            if let (
                Some((properties, property_prefixes)),
                Some((durations, duration_prefixes)),
                Some((delays, delay_prefixes)),
                Some((timing_functions, timing_prefixes)),
            ) = (
                &mut _properties,
                &mut _durations,
                &mut _delays,
                &mut _timing_functions,
            ) {
                // Find the intersection of prefixes with the same value.
                // Remove that from the prefixes of each of the properties. The remaining
                // prefixes will be handled by outputting individual properties below.
                let intersection =
                    *property_prefixes & *duration_prefixes & *delay_prefixes & *timing_prefixes;
                if !intersection.is_empty() {
                    let (transitions, rtl_transitions) = lower_shorthand(
                        arena,
                        properties,
                        durations,
                        delays,
                        timing_functions,
                        context,
                    );

                    if let Some(rtl_transitions) = rtl_transitions {
                        context.add_logical_rule(
                            Property::Transition((transitions, intersection)),
                            Property::Transition((rtl_transitions, intersection)),
                        );
                    } else {
                        dest.push(Property::Transition((transitions, intersection)));
                    }

                    property_prefixes.remove(intersection);
                    duration_prefixes.remove(intersection);
                    timing_prefixes.remove(intersection);
                    delay_prefixes.remove(intersection);
                }
            }

            if let Some((mut properties, prefix)) = _properties.take() {
                if !prefix.is_empty() {
                    let rtl_properties = lower_longhands(
                        arena,
                        &mut properties,
                        ValueLists {
                            durations: paired(&mut _durations, prefix),
                            delays: paired(&mut _delays, prefix),
                            timing_functions: paired(&mut _timing_functions, prefix),
                        },
                        context,
                    );
                    if let Some(rtl_properties) = rtl_properties {
                        context.add_logical_rule(
                            Property::TransitionProperty((properties, prefix)),
                            Property::TransitionProperty((rtl_properties, prefix)),
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
                    dest.push(Property::TransitionTimingFunction((
                        timing_functions,
                        prefix,
                    )));
                }
            }

            self.reset();
        }

        fn reset(&mut self) {
            self.properties = None;
            self.durations = None;
            self.delays = None;
            self.timing_functions = None;
            self.has_any = false;
        }
    }

    /// The names that one as-written `transition-property` entry is lowered to for the targets.
    struct Lowered {
        ltr: SmallList<PropertyId, 4>,
        /// The names for right-to-left text, for an inline logical property.
        rtl: Option<SmallList<PropertyId, 4>>,
    }

    impl Lowered {
        fn rtl_names(&self) -> &SmallList<PropertyId, 4> {
            self.rtl.as_ref().unwrap_or(&self.ltr)
        }
    }

    /// The as-written entry directly in front of the one that is lowered.
    #[derive(Default)]
    struct Preceding {
        entry: Option<PropertyId>,
        /// The vendor prefixes of `entry` and of the entries of the same property directly
        /// in front of it. Empty when one of them is unprefixed.
        prefixes: VendorPrefix,
    }

    impl Preceding {
        /// The vendor prefixes that the entries directly in front of `property_id` already
        /// list for the same property.
        fn listed(&self, property_id: &PropertyId) -> VendorPrefix {
            match self.entry {
                Some(entry) if !self.prefixes.is_empty() && entry.tag() == property_id.tag() => {
                    self.prefixes
                }
                _ => VendorPrefix::empty(),
            }
        }

        fn advance(&mut self, property_id: &PropertyId) {
            let prefix = property_id.prefix();
            self.prefixes = if prefix.is_empty() || prefix.contains(VendorPrefix::NONE) {
                VendorPrefix::empty()
            } else {
                self.listed(property_id) | prefix
            };
            self.entry = Some(*property_id);
        }
    }

    /// Lowers one as-written `transition-property` entry: a logical property to its physical
    /// names, and any other property to the vendor prefixes and the `-webkit-` mask name that
    /// the targets need.
    ///
    /// A merged rule and the generated `:lang()` rules are minified again, so the names this
    /// handler wrote come back as entries. It writes a prefixed name and a `-webkit-` mask
    /// name directly in front of the entry they belong to, so a name that `preceding` already
    /// lists is not added a second time.
    fn lower_entry(
        property_id: &PropertyId,
        preceding: &mut Preceding,
        context: &PropertyHandlerContext,
    ) -> Lowered {
        fn for_targets(
            names: &[PropertyId],
            context: &PropertyHandlerContext,
        ) -> SmallList<PropertyId, 4> {
            let mut names = SmallList::<PropertyId, 4>::init_inlined(names);
            for name in names.slice_mut() {
                name.set_prefixes_for_targets(&context.targets);
            }
            names
        }

        let lowered = match get_logical_properties(property_id) {
            LogicalPropertyId::Block(feature, block) if context.should_compile_logical(feature) => {
                Lowered {
                    ltr: for_targets(block, context),
                    rtl: None,
                }
            }
            LogicalPropertyId::Inline(feature, ltr, rtl)
                if context.should_compile_logical(feature) =>
            {
                Lowered {
                    ltr: for_targets(ltr, context),
                    rtl: Some(for_targets(rtl, context)),
                }
            }
            _ => {
                let mut names = SmallList::<PropertyId, 4>::default();
                // Expand vendor prefixes for targets.
                let mut id = *property_id;
                id.set_prefixes_for_targets(&context.targets);
                let listed = preceding.listed(property_id);
                if !listed.is_empty() {
                    let added = id.prefix().difference(property_id.prefix());
                    id = id.with_prefix(id.prefix().difference(added & listed));
                }

                // Expand mask properties, which use different vendor-prefixed names.
                if let Some(webkit) = masking::get_webkit_mask_property(&id)
                    && preceding.entry != Some(webkit)
                    && context
                        .targets
                        .prefixes(VendorPrefix::NONE, Feature::MaskBorder)
                        .contains(VendorPrefix::WEBKIT)
                {
                    names.append(webkit);
                }
                names.append(id);
                Lowered {
                    ltr: names,
                    rtl: None,
                }
            }
        };

        preceding.advance(property_id);
        lowered
    }

    /// The value of `list` for the entry at `index` of `transition-property`. A list that
    /// is shorter than `transition-property` repeats.
    fn cycled<T>(list: &SmallList<T, 1>, index: u32) -> Option<&T> {
        if list.is_empty() {
            return None;
        }
        Some(list.at(index % list.len()))
    }

    /// Builds the transitions of a `transition` shorthand, and the transitions for
    /// right-to-left text when an inline logical property is in the list.
    ///
    /// Every name an entry is lowered to gets the duration, delay and timing function of
    /// that entry: CSS Transitions matches the lists up by the index of the entry as
    /// written, and the longhands of a shorthand use the values at the index of the
    /// shorthand. lightningcss lengthens `transition-property` first and matches by position
    /// afterwards, which turns `inset 1s, opacity 2s` into
    /// `top 1s, bottom 2s, left 1s, right 2s, opacity 1s`.
    fn lower_shorthand(
        arena: &bun_alloc::Arena,
        properties: &SmallList<PropertyId, 1>,
        durations: &SmallList<Time, 1>,
        delays: &SmallList<Time, 1>,
        timing_functions: &SmallList<EasingFunction, 1>,
        context: &PropertyHandlerContext,
    ) -> (SmallList<Transition, 1>, Option<SmallList<Transition, 1>>) {
        fn append(
            arena: &bun_alloc::Arena,
            transitions: &mut SmallList<Transition, 1>,
            names: &SmallList<PropertyId, 4>,
            entry: &Transition,
        ) {
            for name in names.slice() {
                // Expand vendor prefixes into multiple transitions.
                let prefixes = name.prefix().or_none();
                for &prefix in VendorPrefix::FIELDS {
                    if prefixes.contains(prefix) {
                        let mut transition = entry.deep_clone(arena);
                        transition.property = name.with_prefix(prefix);
                        transitions.append(transition);
                    }
                }
            }
        }

        let mut transitions = SmallList::<Transition, 1>::init_capacity(properties.len());
        let mut rtl_transitions: Option<SmallList<Transition, 1>> = None;
        let mut preceding = Preceding::default();
        for (index, property_id) in (0u32..).zip(properties.slice()) {
            let lowered = lower_entry(property_id, &mut preceding, context);
            let entry = Transition {
                property: *property_id,
                duration: cycled(durations, index)
                    .map_or(Time::Seconds(0.0), |duration| duration.deep_clone(arena)),
                delay: cycled(delays, index)
                    .map_or(Time::Seconds(0.0), |delay| delay.deep_clone(arena)),
                timing_function: cycled(timing_functions, index)
                    .map_or(EasingFunction::Ease, |timing| timing.deep_clone(arena)),
            };

            // Clone the transitions to create the RTL version only when needed.
            if lowered.rtl.is_some() && rtl_transitions.is_none() {
                rtl_transitions = Some(transitions.deep_clone(arena));
            }
            if let Some(rtl_transitions) = &mut rtl_transitions {
                append(arena, rtl_transitions, lowered.rtl_names(), &entry);
            }
            append(arena, &mut transitions, &lowered.ltr, &entry);
        }
        (transitions, rtl_transitions)
    }

    /// The value lists that `flush` writes as longhands under a vendor prefix that the
    /// `transition-property` longhand is also written under. `lower_longhands` destructures
    /// it, so a list that is added here has to be handled there.
    struct ValueLists<'a> {
        durations: Option<&'a mut SmallList<Time, 1>>,
        delays: Option<&'a mut SmallList<Time, 1>>,
        timing_functions: Option<&'a mut SmallList<EasingFunction, 1>>,
    }

    fn paired<T>(
        list: &mut Option<(SmallList<T, 1>, VendorPrefix)>,
        property_prefixes: VendorPrefix,
    ) -> Option<&mut SmallList<T, 1>> {
        match list {
            Some((list, prefixes)) if prefixes.intersects(property_prefixes) => Some(list),
            _ => None,
        }
    }

    /// A list whose values are all equal pairs with any number of names as it is.
    fn values_differ<T: PartialEq>(list: &SmallList<T, 1>) -> bool {
        let values = list.slice();
        values.iter().any(|value| *value != values[0])
    }

    /// Appends `names` to a `transition-property` list. With `per_name`, a property with
    /// several vendor prefixes becomes one entry per prefix, in the order it is printed.
    fn append_names(
        list: &mut SmallList<PropertyId, 1>,
        names: &SmallList<PropertyId, 4>,
        per_name: bool,
    ) {
        for name in names.slice() {
            if !per_name {
                list.append(*name);
                continue;
            }
            let prefixes = name.prefix().or_none();
            for &prefix in VendorPrefix::FIELDS {
                if prefixes.contains(prefix) {
                    list.append(name.with_prefix(prefix));
                }
            }
        }
    }

    /// A `transition-property` longhand from the first entry on that is lowered to several
    /// names. The lists are only ever appended to.
    struct Lengthened {
        ltr: SmallList<PropertyId, 1>,
        rtl: Option<SmallList<PropertyId, 1>>,
        /// How many names each as-written entry became. Kept when a value list needs it.
        names_per_entry: SmallList<u32, 8>,
    }

    impl Lengthened {
        /// Starts from the first `index` entries, which were lowered in place to one name each.
        #[cold]
        fn start(
            properties: &SmallList<PropertyId, 1>,
            mut rtl_properties: Option<SmallList<PropertyId, 1>>,
            index: u32,
            per_name: bool,
        ) -> Self {
            // Room for one logical shorthand that is lowered to four names.
            let mut ltr = SmallList::<PropertyId, 1>::init_capacity(properties.len() + 3);
            ltr.append_slice(&properties.slice()[..index as usize]);
            if let Some(rtl_properties) = &mut rtl_properties {
                rtl_properties.set_len(index);
            }
            let mut names_per_entry = SmallList::<u32, 8>::default();
            if per_name {
                names_per_entry.ensure_total_capacity(properties.len());
                for _ in 0..index {
                    names_per_entry.append(1);
                }
            }
            Self {
                ltr,
                rtl: rtl_properties,
                names_per_entry,
            }
        }

        fn append(&mut self, arena: &bun_alloc::Arena, lowered: &Lowered, per_name: bool) {
            // Clone properties to create RTL version only when needed.
            if lowered.rtl.is_some() && self.rtl.is_none() {
                self.rtl = Some(self.ltr.deep_clone(arena));
            }
            if let Some(rtl) = &mut self.rtl {
                append_names(rtl, lowered.rtl_names(), per_name);
            }
            let before = self.ltr.len();
            append_names(&mut self.ltr, &lowered.ltr, per_name);
            if per_name {
                self.names_per_entry.append(self.ltr.len() - before);
            }
            // The two names of an inline logical property need the same vendor prefixes.
            debug_assert!(
                self.rtl
                    .as_ref()
                    .is_none_or(|rtl| rtl.len() == self.ltr.len())
            );
        }
    }

    /// Rewrites `list` so that it is index-parallel with a lengthened `transition-property`:
    /// the value of each as-written entry is written once per name the entry became.
    fn repeat_per_name<'bump, T: DeepClone<'bump>>(
        arena: &'bump bun_alloc::Arena,
        list: &mut SmallList<T, 1>,
        names_per_entry: &[u32],
        names: u32,
    ) {
        let mut repeated = SmallList::<T, 1>::init_capacity(names);
        for (index, &count) in (0u32..).zip(names_per_entry) {
            let value = list.at(index % list.len());
            for _ in 0..count {
                repeated.append(value.deep_clone(arena));
            }
        }
        *list = repeated;
    }

    /// Lowers a `transition-property` list that `flush` writes as a longhand, and returns
    /// the list for right-to-left text when an inline logical property is in it.
    ///
    /// A browser matches the list up with the value lists by position. So when an entry is
    /// lowered to several names next to a list of `value_lists` whose values differ, the
    /// value of the entry is repeated for each of its names. A property with several vendor
    /// prefixes is then stored as one entry per prefix, so that the lists are still
    /// index-parallel when they are lowered again.
    ///
    /// A value list that this flush does not hold (another rule, the `!important`
    /// declarations of the same block) cannot be rewritten here. It keeps matching the
    /// lowered list by position, as in lightningcss.
    fn lower_longhands(
        arena: &bun_alloc::Arena,
        properties: &mut SmallList<PropertyId, 1>,
        value_lists: ValueLists<'_>,
        context: &PropertyHandlerContext,
    ) -> Option<SmallList<PropertyId, 1>> {
        let ValueLists {
            durations,
            delays,
            timing_functions,
        } = value_lists;
        let durations = durations.filter(|list| values_differ(list));
        let delays = delays.filter(|list| values_differ(list));
        let timing_functions = timing_functions.filter(|list| values_differ(list));
        let per_name = durations.is_some() || delays.is_some() || timing_functions.is_some();

        let mut rtl_properties: Option<SmallList<PropertyId, 1>> = None;
        let mut lengthened: Option<Lengthened> = None;
        let mut preceding = Preceding::default();
        for index in 0..properties.len() {
            let lowered = lower_entry(properties.at(index), &mut preceding, context);
            let one_name = lowered.ltr.len() == 1
                && !(per_name && lowered.ltr.at(0).prefix().bits().count_ones() > 1);
            if one_name && lengthened.is_none() {
                // Clone properties to create RTL version only when needed.
                if lowered.rtl.is_some() && rtl_properties.is_none() {
                    rtl_properties = Some(properties.deep_clone(arena));
                }
                if let Some(rtl_properties) = &mut rtl_properties {
                    *rtl_properties.r#mut(index) = *lowered.rtl_names().at(0);
                }
                *properties.r#mut(index) = *lowered.ltr.at(0);
                continue;
            }
            lengthened
                .get_or_insert_with(|| {
                    Lengthened::start(properties, rtl_properties.take(), index, per_name)
                })
                .append(arena, &lowered, per_name);
        }

        let Some(lengthened) = lengthened else {
            return rtl_properties;
        };
        let names = lengthened.ltr.len();
        let names_per_entry = lengthened.names_per_entry.slice();
        if let Some(durations) = durations {
            repeat_per_name(arena, durations, names_per_entry, names);
        }
        if let Some(delays) = delays {
            repeat_per_name(arena, delays, names_per_entry, names);
        }
        if let Some(timing_functions) = timing_functions {
            repeat_per_name(arena, timing_functions, names_per_entry, names);
        }
        *properties = lengthened.ltr;
        lengthened.rtl
    }

    enum LogicalPropertyId {
        None,
        Block(compat::Feature, &'static [PropertyId]),
        Inline(
            compat::Feature,
            &'static [PropertyId],
            &'static [PropertyId],
        ),
    }

    fn get_logical_properties(property_id: &PropertyId) -> LogicalPropertyId {
        use LogicalPropertyId::{Block, Inline};
        use compat::Feature as F;
        match property_id {
            PropertyId::BlockSize => Block(F::LogicalSize, &[PropertyId::Height]),
            PropertyId::InlineSize => {
                Inline(F::LogicalSize, &[PropertyId::Width], &[PropertyId::Height])
            }
            PropertyId::MinBlockSize => Block(F::LogicalSize, &[PropertyId::MinHeight]),
            PropertyId::MaxBlockSize => Block(F::LogicalSize, &[PropertyId::MaxHeight]),
            PropertyId::MinInlineSize => Inline(
                F::LogicalSize,
                &[PropertyId::MinWidth],
                &[PropertyId::MinHeight],
            ),
            PropertyId::MaxInlineSize => Inline(
                F::LogicalSize,
                &[PropertyId::MaxWidth],
                &[PropertyId::MaxHeight],
            ),

            PropertyId::InsetBlockStart => Block(F::LogicalInset, &[PropertyId::Top]),
            PropertyId::InsetBlockEnd => Block(F::LogicalInset, &[PropertyId::Bottom]),
            PropertyId::InsetInlineStart => {
                Inline(F::LogicalInset, &[PropertyId::Left], &[PropertyId::Right])
            }
            PropertyId::InsetInlineEnd => {
                Inline(F::LogicalInset, &[PropertyId::Right], &[PropertyId::Left])
            }
            PropertyId::InsetBlock => {
                Block(F::LogicalInset, &[PropertyId::Top, PropertyId::Bottom])
            }
            PropertyId::InsetInline => {
                Block(F::LogicalInset, &[PropertyId::Left, PropertyId::Right])
            }
            PropertyId::Inset => Block(
                F::LogicalInset,
                &[
                    PropertyId::Top,
                    PropertyId::Bottom,
                    PropertyId::Left,
                    PropertyId::Right,
                ],
            ),

            PropertyId::MarginBlockStart => Block(F::LogicalMargin, &[PropertyId::MarginTop]),
            PropertyId::MarginBlockEnd => Block(F::LogicalMargin, &[PropertyId::MarginBottom]),
            PropertyId::MarginInlineStart => Inline(
                F::LogicalMargin,
                &[PropertyId::MarginLeft],
                &[PropertyId::MarginRight],
            ),
            PropertyId::MarginInlineEnd => Inline(
                F::LogicalMargin,
                &[PropertyId::MarginRight],
                &[PropertyId::MarginLeft],
            ),
            PropertyId::MarginBlock => Block(
                F::LogicalMargin,
                &[PropertyId::MarginTop, PropertyId::MarginBottom],
            ),
            PropertyId::MarginInline => Block(
                F::LogicalMargin,
                &[PropertyId::MarginLeft, PropertyId::MarginRight],
            ),

            PropertyId::PaddingBlockStart => Block(F::LogicalPadding, &[PropertyId::PaddingTop]),
            PropertyId::PaddingBlockEnd => Block(F::LogicalPadding, &[PropertyId::PaddingBottom]),
            PropertyId::PaddingInlineStart => Inline(
                F::LogicalPadding,
                &[PropertyId::PaddingLeft],
                &[PropertyId::PaddingRight],
            ),
            PropertyId::PaddingInlineEnd => Inline(
                F::LogicalPadding,
                &[PropertyId::PaddingRight],
                &[PropertyId::PaddingLeft],
            ),
            PropertyId::PaddingBlock => Block(
                F::LogicalPadding,
                &[PropertyId::PaddingTop, PropertyId::PaddingBottom],
            ),
            PropertyId::PaddingInline => Block(
                F::LogicalPadding,
                &[PropertyId::PaddingLeft, PropertyId::PaddingRight],
            ),

            PropertyId::BorderBlockStart => Block(F::LogicalBorders, &[PropertyId::BorderTop]),
            PropertyId::BorderBlockStartWidth => {
                Block(F::LogicalBorders, &[PropertyId::BorderTopWidth])
            }
            PropertyId::BorderBlockStartColor => {
                Block(F::LogicalBorders, &[PropertyId::BorderTopColor])
            }
            PropertyId::BorderBlockStartStyle => {
                Block(F::LogicalBorders, &[PropertyId::BorderTopStyle])
            }

            PropertyId::BorderBlockEnd => Block(F::LogicalBorders, &[PropertyId::BorderBottom]),
            PropertyId::BorderBlockEndWidth => {
                Block(F::LogicalBorders, &[PropertyId::BorderBottomWidth])
            }
            PropertyId::BorderBlockEndColor => {
                Block(F::LogicalBorders, &[PropertyId::BorderBottomColor])
            }
            PropertyId::BorderBlockEndStyle => {
                Block(F::LogicalBorders, &[PropertyId::BorderBottomStyle])
            }

            PropertyId::BorderInlineStart => Inline(
                F::LogicalBorders,
                &[PropertyId::BorderLeft],
                &[PropertyId::BorderRight],
            ),
            PropertyId::BorderInlineStartWidth => Inline(
                F::LogicalBorders,
                &[PropertyId::BorderLeftWidth],
                &[PropertyId::BorderRightWidth],
            ),
            PropertyId::BorderInlineStartColor => Inline(
                F::LogicalBorders,
                &[PropertyId::BorderLeftColor],
                &[PropertyId::BorderRightColor],
            ),
            PropertyId::BorderInlineStartStyle => Inline(
                F::LogicalBorders,
                &[PropertyId::BorderLeftStyle],
                &[PropertyId::BorderRightStyle],
            ),

            PropertyId::BorderInlineEnd => Inline(
                F::LogicalBorders,
                &[PropertyId::BorderRight],
                &[PropertyId::BorderLeft],
            ),
            PropertyId::BorderInlineEndWidth => Inline(
                F::LogicalBorders,
                &[PropertyId::BorderRightWidth],
                &[PropertyId::BorderLeftWidth],
            ),
            PropertyId::BorderInlineEndColor => Inline(
                F::LogicalBorders,
                &[PropertyId::BorderRightColor],
                &[PropertyId::BorderLeftColor],
            ),
            PropertyId::BorderInlineEndStyle => Inline(
                F::LogicalBorders,
                &[PropertyId::BorderRightStyle],
                &[PropertyId::BorderLeftStyle],
            ),

            PropertyId::BorderBlock => Block(
                F::LogicalBorders,
                &[PropertyId::BorderTop, PropertyId::BorderBottom],
            ),
            PropertyId::BorderBlockColor => Block(
                F::LogicalBorders,
                &[PropertyId::BorderTopColor, PropertyId::BorderBottomColor],
            ),
            PropertyId::BorderBlockWidth => Block(
                F::LogicalBorders,
                &[PropertyId::BorderTopWidth, PropertyId::BorderBottomWidth],
            ),
            PropertyId::BorderBlockStyle => Block(
                F::LogicalBorders,
                &[PropertyId::BorderTopStyle, PropertyId::BorderBottomStyle],
            ),

            PropertyId::BorderInline => Block(
                F::LogicalBorders,
                &[PropertyId::BorderLeft, PropertyId::BorderRight],
            ),
            PropertyId::BorderInlineColor => Block(
                F::LogicalBorders,
                &[PropertyId::BorderLeftColor, PropertyId::BorderRightColor],
            ),
            PropertyId::BorderInlineWidth => Block(
                F::LogicalBorders,
                &[PropertyId::BorderLeftWidth, PropertyId::BorderRightWidth],
            ),
            PropertyId::BorderInlineStyle => Block(
                F::LogicalBorders,
                &[PropertyId::BorderLeftStyle, PropertyId::BorderRightStyle],
            ),

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
} // mod transition_handler_body
