use bun_css as css;
use bun_css::css_properties::custom::UnparsedProperty;
use bun_css::prefixes::Feature;
use bun_css::Property;
use bun_css::PropertyIdTag;
use bun_css::VendorPrefix;

/// *NOTE* The struct field names must match their corresponding variants in `Property`!
#[derive(Default)]
pub struct FallbackHandler {
    pub color: Option<usize>,
    pub text_shadow: Option<usize>,
    // TODO: add these back plz
    // filter: Option<usize>,
    // backdrop_filter: Option<usize>,
    // fill: Option<usize>,
    // stroke: Option<usize>,
    // caret_color: Option<usize>,
    // caret: Option<usize>,
}

impl FallbackHandler {
    // TODO(port): Zig computed this via @typeInfo(FallbackHandler).Struct.fields.len.
    #[allow(dead_code)]
    const FIELD_COUNT: usize = 2;

    pub fn handle_property(
        &mut self,
        property: &Property,
        dest: &mut css::DeclarationList,
        context: &mut css::PropertyHandlerContext,
    ) -> bool {
        // The Zig source does `inline for (std.meta.fields(FallbackHandler))` and uses
        // `@field` / `@unionInit` keyed on the field name. Rust has no field reflection,
        // so we expand each (field, Property variant, has_vendor_prefix) pair via macro.
        // TODO(port): proc-macro — if the field list grows, generate these arms from a
        // single source of truth shared with `Property`/`PropertyIdTag`.

        macro_rules! handle_unprefixed {
            ($self_field:ident, $Variant:ident) => {
                if let Property::$Variant(payload) = property {
                    let mut val = payload.deep_clone(context.allocator);

                    if $self_field.is_none() {
                        let fallbacks = val.get_fallbacks(context.allocator, context.targets);
                        // PORT NOTE: `has_fallbacks` only used in the vendor-prefixed branch in Zig.
                        let _has_fallbacks = !fallbacks.is_empty();

                        for fallback in fallbacks.slice() {
                            dest.push(Property::$Variant(fallback));
                        }
                    }

                    if $self_field.is_none()
                        || (context.targets.browsers.is_some()
                            && !val.is_compatible(context.targets.browsers.unwrap()))
                    {
                        *$self_field = Some(dest.len());
                        dest.push(Property::$Variant(val));
                    } else if let Some(index) = *$self_field {
                        dest[index] = Property::$Variant(val);
                    } else {
                        // val dropped — Rust Drop handles cleanup (Zig: val.deinit(context.allocator))
                        drop(val);
                    }

                    return true;
                }
            };
        }

        macro_rules! handle_prefixed {
            ($self_field:ident, $Variant:ident, $FeatureVariant:ident) => {
                if let Property::$Variant((payload, prefix)) = property {
                    let mut val = payload.deep_clone(context.allocator);
                    let mut prefix = *prefix;

                    if $self_field.is_none() {
                        let fallbacks = val.get_fallbacks(context.allocator, context.targets);
                        let has_fallbacks = !fallbacks.is_empty();

                        for fallback in fallbacks.slice() {
                            dest.push(Property::$Variant((fallback, prefix)));
                        }
                        // TODO(port): Zig source reads `@field(property, field.name[1])` here,
                        // which indexes the *field name string* (a bug) and would mutate through
                        // `*const Property`. Ported as the apparent intent: if fallbacks were
                        // emitted and the incoming prefix contains `.none`, narrow to `.none`.
                        // Verify against lightningcss upstream in Phase B.
                        if has_fallbacks && prefix.contains(VendorPrefix::NONE) {
                            prefix = VendorPrefix::NONE;
                        }
                    }

                    if $self_field.is_none()
                        || (context.targets.browsers.is_some()
                            && !val.is_compatible(context.targets.browsers.unwrap()))
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
                // suppress unused-macro-input warning when this arm is the only prefixed one
                let _ = Feature::$FeatureVariant;
            };
        }

        // PORT NOTE: reshaped for borrowck — pre-borrow each self.<field> as &mut so the
        // macro body can both read and assign it without re-borrowing `self`.
        let this = &mut *self;
        let color = &mut this.color;
        let text_shadow = &mut this.text_shadow;

        // PropertyIdTag::Color has no vendor prefix.
        handle_unprefixed!(color, Color);
        // PropertyIdTag::TextShadow has no vendor prefix.
        // TODO(port): confirm `PropertyIdTag::has_vendor_prefix(TextShadow)` is false; the Zig
        // computed this at comptime. If it is actually prefixed, swap to `handle_prefixed!`.
        handle_unprefixed!(text_shadow, TextShadow);

        if let Property::Unparsed(val) = property {
            let val: &UnparsedProperty = val;
            let (mut unparsed, index): (UnparsedProperty, &mut Option<usize>) = 'unparsed_and_index: {
                macro_rules! match_unparsed_unprefixed {
                    ($self_field:ident, $Variant:ident) => {
                        if val.property_id.tag() == PropertyIdTag::$Variant {
                            let newval = val.deep_clone(context.allocator);
                            break 'unparsed_and_index (newval, $self_field);
                        }
                    };
                }
                macro_rules! match_unparsed_prefixed {
                    ($self_field:ident, $Variant:ident, $FeatureVariant:ident) => {
                        if val.property_id.tag() == PropertyIdTag::$Variant {
                            // TODO(port): Zig accessed `@field(val.property_id, field.name)[1]`
                            // to get the VendorPrefix from the PropertyId payload. Map to the
                            // ported PropertyId accessor in Phase B.
                            let newval = if val
                                .property_id
                                .prefix()
                                .contains(VendorPrefix::NONE)
                            {
                                val.get_prefixed(context.targets, Feature::$FeatureVariant)
                            } else {
                                val.deep_clone(context.allocator)
                            };
                            break 'unparsed_and_index (newval, $self_field);
                        }
                    };
                }

                match_unparsed_unprefixed!(color, Color);
                match_unparsed_unprefixed!(text_shadow, TextShadow);
                // Silence unused-macro warning until a prefixed property is re-enabled.
                #[allow(unused_macros)]
                let _ = &match_unparsed_prefixed;

                return false;
            };

            context.add_unparsed_fallbacks(&mut unparsed);
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

    pub fn finalize(
        &mut self,
        _dest: &mut css::DeclarationList,
        _context: &mut css::PropertyHandlerContext,
    ) {
        // Zig: inline for (std.meta.fields(FallbackHandler)) |f| @field(this, f.name) = null;
        self.color = None;
        self.text_shadow = None;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/properties/prefix_handler.zig (135 lines)
//   confidence: medium
//   todos:      4
//   notes:      Heavy @typeInfo/@field reflection unrolled via macro_rules! for the 2 active fields; Zig line 55 `field.name[1]` looks like an upstream bug — ported as apparent intent, verify in Phase B.
// ──────────────────────────────────────────────────────────────────────────
