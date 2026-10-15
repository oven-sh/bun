use crate as css;
use crate::VendorPrefix;
use crate::css_properties::custom::UnparsedProperty;
use crate::css_properties::{Property, PropertyId, PropertyIdTag};
use crate::generics::{DeepClone as _, IsCompatible as _};
use crate::prefixes::Feature;
use bun_alloc::ArenaVecExt as _;

/// *NOTE* The struct field names must match their corresponding variants in `Property`!
#[derive(Default)]
pub struct FallbackHandler {
    pub(crate) color: Option<usize>,
    pub(crate) text_shadow: Option<usize>,
    pub(crate) filter: Option<usize>,
    pub(crate) backdrop_filter: Option<usize>,
    // The remaining fallback fields are not implemented yet.
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

        // Same as `handle_unprefixed!`, for a `Property::$Variant((value, VendorPrefix))`
        // payload whose prefixes come from `Feature::$Variant`. Color fallbacks
        // are printed with the prefixed names. The final (widest gamut) value
        // is then printed unprefixed only: the engines that need the prefix do
        // not support the newer color spaces.
        macro_rules! handle_prefixed {
            ($self_field:ident, $Variant:ident) => {
                if let Property::$Variant((payload, prefix)) = property {
                    let mut val = payload.deep_clone(arena);
                    let mut prefix = context.targets.prefixes(*prefix, Feature::$Variant);

                    if $self_field.is_none() {
                        let fallbacks = val.get_fallbacks(arena, &context.targets);
                        let has_fallbacks = !fallbacks.is_empty();
                        for fb in fallbacks.to_owned_slice().into_vec() {
                            dest.push(Property::$Variant((fb, prefix)));
                        }
                        if has_fallbacks && prefix.contains(VendorPrefix::NONE) {
                            prefix = VendorPrefix::NONE;
                        }
                    }

                    if $self_field.is_none()
                        || (context.targets.browsers.is_some()
                            && !val.is_compatible(&context.targets.browsers.unwrap()))
                    {
                        *$self_field = Some(dest.len());
                        dest.push(Property::$Variant((val, prefix)));
                    } else if let Some(index) = *$self_field {
                        dest[index] = Property::$Variant((val, prefix));
                    } else {
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
        let filter = &mut this.filter;
        let backdrop_filter = &mut this.backdrop_filter;

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
        handle_prefixed!(filter, Filter);
        handle_prefixed!(backdrop_filter, BackdropFilter);

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
                macro_rules! match_unparsed_prefixed {
                    ($self_field:ident, $Variant:ident) => {
                        if let PropertyId::$Variant(prefix) = val.property_id {
                            let newval = if prefix.contains(VendorPrefix::NONE) {
                                val.get_prefixed(arena, &context.targets, Feature::$Variant)
                            } else {
                                val.deep_clone(arena)
                            };
                            break 'unparsed_and_index (newval, $self_field);
                        }
                    };
                }

                match_unparsed_unprefixed!(color, Color);
                match_unparsed_unprefixed!(text_shadow, TextShadow);
                match_unparsed_prefixed!(filter, Filter);
                match_unparsed_prefixed!(backdrop_filter, BackdropFilter);

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
        self.filter = None;
        self.backdrop_filter = None;
    }
}
