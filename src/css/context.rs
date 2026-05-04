use crate::css_parser as css;

use css::css_rules::media::MediaRule;
use css::media_query::{MediaCondition, MediaFeature, MediaFeatureId, MediaList, MediaQuery};

use css::css_properties::custom::UnparsedProperty;

// TODO(port): LIFETIMES.tsv prescribes `&'a HashSet<String>` for unused_symbols verbatim,
// but std HashSet is SipHash-backed and `String` forces UTF-8 validation on arbitrary-byte
// CSS symbol names. The underlying Zig type is `std.StringArrayHashMapUnmanaged(void)`.
// Phase B: retype to `&'a bun_collections::ArrayHashMap<Box<[u8]>, ()>` (or a
// `StringArrayHashSet` alias), update the LIFETIMES.tsv row, and drop this import.
use std::collections::HashSet;

pub struct SupportsEntry {
    pub condition: css::SupportsCondition,
    pub declarations: Vec<css::Property>,
    pub important_declarations: Vec<css::Property>,
}

// PORT NOTE: `deinit(this, allocator)` deleted — all fields own their storage and drop
// automatically. `css.deepDeinit` over the Vecs is handled by `Vec<Property>`'s Drop.

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum DeclarationContext {
    None,
    StyleRule,
    Keyframes,
    StyleAttribute,
}

pub struct PropertyHandlerContext<'a> {
    // PORT NOTE: `allocator: Allocator` field dropped — Vec/Box use the global mimalloc
    // allocator. The CSS crate is arena-eligible per PORTING.md, but this struct's lists
    // are reset/reused across rules rather than bulk-freed with an arena.
    // PERF(port): was arena-backed ArrayListUnmanaged — profile in Phase B.
    pub targets: css::targets::Targets,
    pub is_important: bool,
    pub supports: Vec<SupportsEntry>,
    pub ltr: Vec<css::Property>,
    pub rtl: Vec<css::Property>,
    pub dark: Vec<css::Property>,
    pub context: DeclarationContext,
    pub unused_symbols: &'a HashSet<String>,
}

impl<'a> PropertyHandlerContext<'a> {
    pub fn new(
        targets: css::targets::Targets,
        unused_symbols: &'a HashSet<String>,
    ) -> PropertyHandlerContext<'a> {
        PropertyHandlerContext {
            targets,
            is_important: false,
            supports: Vec::new(),
            ltr: Vec::new(),
            rtl: Vec::new(),
            dark: Vec::new(),
            context: DeclarationContext::None,
            unused_symbols,
        }
    }

    pub fn child(&self, context: DeclarationContext) -> PropertyHandlerContext<'a> {
        PropertyHandlerContext {
            targets: self.targets,
            is_important: false,
            supports: Vec::new(),
            ltr: Vec::new(),
            rtl: Vec::new(),
            dark: Vec::new(),
            context,
            unused_symbols: self.unused_symbols,
        }
    }

    pub fn add_dark_rule(&mut self, property: css::Property) {
        self.dark.push(property);
    }

    pub fn add_logical_rule(&mut self, ltr: css::Property, rtl: css::Property) {
        self.ltr.push(ltr);
        self.rtl.push(rtl);
    }

    pub fn should_compile_logical(&self, feature: css::compat::Feature) -> bool {
        // Don't convert logical properties in style attributes because
        // our fallbacks rely on extra rules to define --ltr and --rtl.
        if self.context == DeclarationContext::StyleAttribute {
            return false;
        }

        self.targets.should_compile_logical(feature)
    }

    pub fn get_supports_rules<T>(&self, style_rule: &css::StyleRule<T>) -> Vec<css::CssRule<T>> {
        if self.supports.is_empty() {
            return Vec::new();
        }

        let mut dest: Vec<css::CssRule<T>> = Vec::with_capacity(self.supports.len());

        for entry in &self.supports {
            // PERF(port): was appendAssumeCapacity
            dest.push(css::CssRule::Supports(css::SupportsRule {
                condition: entry.condition.deep_clone(),
                rules: css::CssRuleList {
                    v: {
                        let mut v: Vec<css::CssRule<T>> = Vec::with_capacity(1);

                        // PERF(port): was appendAssumeCapacity
                        v.push(css::CssRule::Style(css::StyleRule {
                            selectors: style_rule.selectors.deep_clone(),
                            vendor_prefix: css::VendorPrefix::NONE,
                            declarations: css::DeclarationBlock {
                                declarations: css::deep_clone(&entry.declarations),
                                important_declarations: css::deep_clone(
                                    &entry.important_declarations,
                                ),
                            },
                            rules: css::CssRuleList::default(),
                            loc: style_rule.loc,
                        }));

                        v
                    },
                },
                loc: style_rule.loc,
            }));
        }

        dest
    }

    pub fn get_additional_rules<T>(&self, style_rule: &css::StyleRule<T>) -> Vec<css::CssRule<T>> {
        // TODO: :dir/:lang raises the specificity of the selector. Use :where to lower it?
        let mut dest: Vec<css::CssRule<T>> = Vec::new();

        if !self.ltr.is_empty() {
            self.get_additional_rules_helper(
                css::selector::parser::Direction::Ltr,
                &self.ltr,
                style_rule,
                &mut dest,
            );
        }

        if !self.rtl.is_empty() {
            self.get_additional_rules_helper(
                css::selector::parser::Direction::Rtl,
                &self.rtl,
                style_rule,
                &mut dest,
            );
        }

        if !self.dark.is_empty() {
            dest.push(css::CssRule::Media(MediaRule {
                query: MediaList {
                    media_queries: {
                        let mut list: Vec<MediaQuery> = Vec::with_capacity(1);

                        // PERF(port): was appendAssumeCapacity
                        list.push(MediaQuery {
                            qualifier: None,
                            media_type: css::media_query::MediaType::All,
                            condition: Some(MediaCondition::Feature(MediaFeature::Plain {
                                // TODO(port): verify exact MediaFeatureName / MediaFeatureValue
                                // variant shapes from css::media_query once ported.
                                name: css::media_query::MediaFeatureName::Standard(
                                    MediaFeatureId::PrefersColorScheme,
                                ),
                                value: css::media_query::MediaFeatureValue::Ident(
                                    css::Ident { v: b"dark" },
                                ),
                            })),
                        });

                        list
                    },
                },
                rules: {
                    let mut list: css::CssRuleList<T> = css::CssRuleList::default();

                    list.v.push(css::CssRule::Style(css::StyleRule {
                        selectors: style_rule.selectors.deep_clone(),
                        vendor_prefix: css::VendorPrefix::NONE,
                        declarations: css::DeclarationBlock {
                            declarations: css::deep_clone(&self.dark),
                            important_declarations: Vec::new(),
                        },
                        rules: css::CssRuleList::default(),
                        loc: style_rule.loc,
                    }));

                    list
                },
                loc: style_rule.loc,
            }));
        }

        dest
    }

    // PORT NOTE: reshaped — Zig passed `comptime dir: []const u8` and `comptime decls: []const u8`
    // and used `@field` to select the Direction variant and the self.ltr/self.rtl Vec by name.
    // Rust has no @field; pass the Direction value and a borrow of the decls Vec directly.
    pub fn get_additional_rules_helper<T>(
        &self,
        dir: css::selector::parser::Direction,
        decls: &Vec<css::Property>,
        sty: &css::StyleRule<T>,
        dest: &mut Vec<css::CssRule<T>>,
    ) {
        let mut selectors = sty.selectors.deep_clone();
        for selector in selectors.v.slice_mut() {
            selector.append(css::Component::NonTsPseudoClass(css::PseudoClass::Dir {
                direction: dir,
            }));
        }

        let rule = css::StyleRule {
            selectors,
            vendor_prefix: css::VendorPrefix::NONE,
            declarations: css::DeclarationBlock {
                declarations: css::deep_clone(decls),
                important_declarations: Vec::new(),
            },
            rules: css::CssRuleList::default(),
            loc: sty.loc,
        };

        dest.push(css::CssRule::Style(rule));
    }

    pub fn reset(&mut self) {
        // PORT NOTE: per-element `deinit()` calls dropped — Vec::clear drops each element,
        // and SupportsEntry / Property own their resources via Drop.
        self.supports.clear();
        self.ltr.clear();
        self.rtl.clear();
        self.dark.clear();
    }

    pub fn add_conditional_property(
        &mut self,
        condition: css::SupportsCondition,
        property: css::Property,
    ) {
        if self.context != DeclarationContext::StyleRule {
            return;
        }

        let found = 'brk: {
            for supp in self.supports.iter_mut() {
                if condition.eql(&supp.condition) {
                    break 'brk Some(supp);
                }
            }
            break 'brk None;
        };

        if let Some(entry) = found {
            if self.is_important {
                entry.important_declarations.push(property);
            } else {
                entry.declarations.push(property);
            }
        } else {
            let mut important_declarations: Vec<css::Property> = Vec::new();
            let mut declarations: Vec<css::Property> = Vec::new();
            if self.is_important {
                important_declarations.push(property);
            } else {
                declarations.push(property);
            }
            self.supports.push(SupportsEntry {
                condition,
                declarations,
                important_declarations,
            });
        }
    }

    pub fn add_unparsed_fallbacks(&mut self, unparsed: &mut UnparsedProperty) {
        if self.context != DeclarationContext::StyleRule
            && self.context != DeclarationContext::StyleAttribute
        {
            return;
        }

        let fallbacks = unparsed.value.get_fallbacks(self.targets);

        for condition_and_fallback in fallbacks.slice() {
            self.add_conditional_property(
                condition_and_fallback.0,
                css::Property::Unparsed(UnparsedProperty {
                    property_id: unparsed.property_id.deep_clone(),
                    value: condition_and_fallback.1,
                }),
            );
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/context.zig (307 lines)
//   confidence: medium
//   todos:      2
//   notes:      allocator field dropped (Vec-backed); @field comptime params reshaped to runtime args; unused_symbols type from LIFETIMES.tsv may need reconciling with bun_collections; MediaFeature/Value variant shapes guessed
// ──────────────────────────────────────────────────────────────────────────
