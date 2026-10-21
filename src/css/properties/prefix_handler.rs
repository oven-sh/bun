use crate as css;
use crate::VendorPrefix;
use crate::css_properties::custom::{CustomPropertyName, UnparsedProperty};
use crate::css_properties::{Property, PropertyId, PropertyIdTag};
use crate::generics::{DeepClone as _, IsCompatible as _};
use crate::prefixes::Feature;
use bun_alloc::ArenaVecExt as _;
use bun_core::strings;

macro_rules! define_prefixes {
    ($($name:ident,)+) => {
        #[derive(Clone, Copy)]
        enum Slot {
            $($name,)+
        }

        const SLOT_COUNT: usize = [$(Slot::$name,)+].len();

        $(const _: () = assert!(matches!(
            PropertyIdTag::$name.prefix_feature(),
            Some(Feature::$name)
        ));)+

        /// The slot of a declaration of these properties, the prefixes it is written with, its feature.
        fn slot_of(property: &Property) -> Option<(Slot, VendorPrefix, Feature)> {
            match property {
                $(Property::$name(value) => Some((Slot::$name, value.1, Feature::$name)),)+
                Property::Unparsed(unparsed) => match unparsed.property_id {
                    $(PropertyId::$name(prefix) => Some((Slot::$name, prefix.or_none(), Feature::$name)),)+
                    _ => None,
                },
                _ => None,
            }
        }

        fn prefixes_mut(property: &mut Property) -> Option<&mut VendorPrefix> {
            match property {
                $(Property::$name(value) => Some(&mut value.1),)+
                Property::Unparsed(unparsed) => unparsed.property_id.prefix_slot_mut(),
                _ => None,
            }
        }

        /// Whether two declarations of one property have the same value. The prefixes can differ.
        fn same_value(a: &Property, b: &Property) -> bool {
            match (a, b) {
                $((Property::$name(a), Property::$name(b)) => css::generic::eql(&a.0, &b.0),)+
                (Property::Unparsed(a), Property::Unparsed(b)) => {
                    a.property_id.tag() == b.property_id.tag() && css::generic::eql(&a.value, &b.value)
                }
                _ => false,
            }
        }
    };
}

// Not here yet: `ClipPath` has no row. `TransformOrigin` and `PerspectiveOrigin` parse no valid value.
define_prefixes! {
    TransformStyle,
    BackfaceVisibility,
    Perspective,
    BoxSizing,
    TabSize,
    Hyphens,
    TextAlignLast,
    TextDecorationSkipInk,
    TextOverflow,
    UserSelect,
    Appearance,
    BoxDecorationBreak,
    TextSizeAdjust,
    PrintColorAdjust,
}

/// Writes the prefixes that the targets need for properties whose prefixed names take the same value.
#[derive(Default)]
pub struct PrefixHandler {
    /// The index in `dest` of the first declaration written since `all`.
    start: Option<usize>,
    /// A declaration only merges into one at or after this index. An unknown name is before it.
    floor: usize,
    /// The index in `dest` of the last declaration of each property.
    last: [usize; SLOT_COUNT],
    /// The prefixes that the author wrote for each property and that no `all` has reset.
    written: [VendorPrefix; SLOT_COUNT],
    /// The prefixes that the `!important` list of the block writes. `all` in the normal list keeps them.
    important: [VendorPrefix; SLOT_COUNT],
}

impl PrefixHandler {
    pub(crate) fn handle_property(
        &mut self,
        property: &Property,
        dest: &mut css::DeclarationList,
        context: &mut css::PropertyHandlerContext,
    ) -> bool {
        let Some((slot, written, feature)) = slot_of(property) else {
            self.see_other(property, dest.len());
            return false;
        };
        let slot = slot as usize;
        let previous = self
            .start
            .filter(|start| self.last[slot] >= *start)
            .map(|_| self.last[slot]);
        let equal = previous.filter(|index| same_value(&dest[*index], property));

        // Unlike lightningcss: a written prefix stays, and a prefix the block already has is not added.
        let mut covered = self.written[slot] | self.important[slot];
        if let Some(index) = equal {
            covered |=
                slot_of(&dest[index]).map_or(VendorPrefix::empty(), |(_, prefixes, _)| prefixes);
        }
        let prefixes = written
            | context
                .targets
                .prefixes(written, feature)
                .difference(covered);
        self.written[slot] |= written.difference(VendorPrefix::NONE);

        if let Some(index) = equal.filter(|index| *index >= self.floor)
            && let Some(merged) = prefixes_mut(&mut dest[index])
        {
            *merged |= prefixes;
            return true;
        }

        let mut declaration = property.deep_clone(dest.bump());
        if let Some(own) = prefixes_mut(&mut declaration) {
            *own = prefixes;
        }
        self.last[slot] = dest.len();
        self.start.get_or_insert(dest.len());
        dest.push(declaration);
        true
    }

    /// For the normal list's handler: what the `!important` list writes. That, or an `all` after it, beats a copy here.
    pub(crate) fn see_important_list(&mut self, important: &css::DeclarationList) {
        for declaration in important.iter() {
            if let Some((slot, prefixes, _)) = slot_of(declaration) {
                self.important[slot as usize] |= prefixes.difference(VendorPrefix::NONE);
            }
        }
    }

    /// For the `!important` list's handler: what the normal list writes after its last `all`. `all` here resets it.
    pub(crate) fn see_normal_list(&mut self, normal: &css::DeclarationList) {
        for declaration in normal.iter() {
            if is_all(declaration) {
                self.written = Default::default();
            } else if let Some((slot, prefixes, _)) = slot_of(declaration) {
                self.written[slot as usize] |= prefixes.difference(VendorPrefix::NONE);
            }
        }
    }

    /// `all` sets every property. An unknown name can be one more spelling (`-khtml-user-select`).
    fn see_other(&mut self, property: &Property, index: usize) {
        if is_all(property) {
            self.close();
        } else if let Property::Custom(custom) = property
            && matches!(custom.name, CustomPropertyName::Unknown(_))
        {
            self.floor = index + 1;
        }
    }

    fn close(&mut self) {
        *self = Self {
            important: self.important,
            ..Self::default()
        };
    }

    pub(crate) fn finalize(
        &mut self,
        _dest: &mut css::DeclarationList,
        _context: &mut css::PropertyHandlerContext,
    ) {
        *self = Self::default();
    }
}

fn is_all(property: &Property) -> bool {
    match property {
        Property::All(_) => true,
        Property::Unparsed(unparsed) => unparsed.property_id.tag() == PropertyIdTag::All,
        Property::Custom(custom) => {
            matches!(custom.name, CustomPropertyName::Unknown(_))
                && strings::eql_case_insensitive_ascii_check_length(custom.name.as_str(), b"all")
        }
        _ => false,
    }
}

/// *NOTE* The struct field names must match their corresponding variants in `Property`!
#[derive(Default)]
pub struct FallbackHandler {
    pub(crate) color: Option<usize>,
    pub(crate) text_shadow: Option<usize>,
    // The remaining fallback fields are not implemented yet.
    // filter: Option<usize>,
    // backdrop_filter: Option<usize>,
    // fill: Option<usize>,
    // stroke: Option<usize>,
    // caret_color: Option<usize>,
    // caret: Option<usize>,
}

impl FallbackHandler {
    pub(crate) fn handle_property(
        &mut self,
        property: &Property,
        dest: &mut css::DeclarationList,
        context: &mut css::PropertyHandlerContext,
    ) -> bool {
        // Each (field, Property variant, has_vendor_prefix) pair is expanded via macro.

        let arena = dest.bump();

        // Each (field, Property variant) pair is expanded via a macro that
        // takes per-type closures for `DeepClone`/`IsCompatible`/`get_fallbacks`,
        // letting each payload type use its own inherent methods.
        macro_rules! handle_unprefixed {
            (
                $self_field:ident,
                $Variant:ident,
                deep_clone = $dc:expr,
                fallbacks  = $fb:expr,
                is_compat  = $ic:expr
            ) => {
                if let Property::$Variant(payload) = property {
                    let mut val = ($dc)(payload, arena);

                    if $self_field.is_none() {
                        // `has_fallbacks` is only consulted in the vendor-prefixed branch.
                        ($fb)(&mut val, arena, &context.targets, dest);
                    }

                    if $self_field.is_none()
                        || (context.targets.browsers.is_some()
                            && !($ic)(&val, &context.targets.browsers.unwrap()))
                    {
                        *$self_field = Some(dest.len());
                        dest.push(Property::$Variant(val));
                    } else if let Some(index) = *$self_field {
                        dest[index] = Property::$Variant(val);
                    } else {
                        // val dropped — Drop handles cleanup
                        drop(val);
                    }

                    return true;
                }
            };
        }

        // Reshaped for borrowck — pre-borrow each self.<field> as &mut so the
        // macro body can both read and assign it without re-borrowing `self`.
        let this = &mut *self;
        let color = &mut this.color;
        let text_shadow = &mut this.text_shadow;

        // PropertyIdTag::Color has no vendor prefix.
        handle_unprefixed!(
            color,
            Color,
            deep_clone = |c: &css::css_values::color::CssColor, a| c.deep_clone(a),
            fallbacks = |v: &mut css::css_values::color::CssColor,
                         a: &bun_alloc::Arena,
                         t,
                         d: &mut css::DeclarationList| {
                let fbs = v.get_fallbacks(a, t);
                for fb in fbs.to_owned_slice().into_vec() {
                    d.push(Property::Color(fb));
                }
            },
            is_compat = |v: &css::css_values::color::CssColor, b| v.is_compatible(b)
        );
        // PropertyIdTag::TextShadow has no vendor prefix.
        handle_unprefixed!(
            text_shadow,
            TextShadow,
            deep_clone =
                |l: &css::SmallList<css::css_properties::text::TextShadow, 1>, a| l.deep_clone(a),
            fallbacks = |v: &mut css::SmallList<css::css_properties::text::TextShadow, 1>,
                         a: &bun_alloc::Arena,
                         t,
                         d: &mut css::DeclarationList| {
                for fb in css::small_list::get_fallbacks_text_shadow(v, a, t)
                    .to_owned_slice()
                    .into_vec()
                {
                    d.push(Property::TextShadow(fb));
                }
            },
            is_compat = |v: &css::SmallList<css::css_properties::text::TextShadow, 1>, b| v
                .is_compatible(b)
        );

        if let Property::Unparsed(val) = property {
            let val: &UnparsedProperty = val;
            let (mut unparsed, index): (UnparsedProperty, &mut Option<usize>) = 'unparsed_and_index: {
                macro_rules! match_unparsed_unprefixed {
                    ($self_field:ident, $Variant:ident) => {
                        if val.property_id.tag() == PropertyIdTag::$Variant {
                            let newval = val.deep_clone(arena);
                            break 'unparsed_and_index (newval, $self_field);
                        }
                    };
                }

                match_unparsed_unprefixed!(color, Color);
                match_unparsed_unprefixed!(text_shadow, TextShadow);
                // (no prefixed properties active yet — `match_unparsed_prefixed!` kept for
                // when filter/backdrop_filter/etc. are re-enabled in this handler.)

                return false;
            };

            context.add_unparsed_fallbacks(arena, &mut unparsed);
            if let Some(i) = *index {
                dest[i] = Property::Unparsed(unparsed);
            } else {
                *index = Some(dest.len());
                dest.push(Property::Unparsed(unparsed));
            }

            return true;
        }

        false
    }

    pub(crate) fn finalize(
        &mut self,
        _dest: &mut css::DeclarationList,
        _context: &mut css::PropertyHandlerContext,
    ) {
        self.color = None;
        self.text_shadow = None;
    }
}
