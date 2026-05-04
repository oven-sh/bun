use bun_css as css;

use css::CustomMedia;
use css::Printer;
use css::PrintErr;
use css::Dependency;
use css::dependencies;

pub mod import;
pub mod layer;
pub mod style;
pub mod keyframes;
pub mod font_face;
pub mod font_palette_values;
pub mod page;
pub mod supports;
pub mod counter_style;
pub mod custom_media;
pub mod namespace;
pub mod unknown;
pub mod document;
pub mod nesting;
pub mod viewport;
pub mod property;
pub mod container;
pub mod scope;
pub mod media;
pub mod starting_style;

pub mod tailwind;

bun_output::declare_scope!(CSS_MINIFY, visible);

// Zig: pub fn CssRule(comptime Rule: type) type { return union(enum) { ... } }
// 'bump: arena lifetime — css is an AST crate (§Allocators), all rule lists are bumpalo-backed.
pub enum CssRule<'bump, R> {
    /// A `@media` rule.
    Media(media::MediaRule<'bump, R>),
    /// An `@import` rule.
    Import(import::ImportRule),
    /// A style rule.
    Style(style::StyleRule<'bump, R>),
    /// A `@keyframes` rule.
    Keyframes(keyframes::KeyframesRule),
    /// A `@font-face` rule.
    FontFace(font_face::FontFaceRule),
    /// A `@font-palette-values` rule.
    FontPaletteValues(font_palette_values::FontPaletteValuesRule),
    /// A `@page` rule.
    Page(page::PageRule),
    /// A `@supports` rule.
    Supports(supports::SupportsRule<'bump, R>),
    /// A `@counter-style` rule.
    CounterStyle(counter_style::CounterStyleRule),
    /// A `@namespace` rule.
    Namespace(namespace::NamespaceRule),
    /// A `@-moz-document` rule.
    MozDocument(document::MozDocumentRule<'bump, R>),
    /// A `@nest` rule.
    Nesting(nesting::NestingRule<'bump, R>),
    /// A `@viewport` rule.
    Viewport(viewport::ViewportRule),
    /// A `@custom-media` rule.
    CustomMedia(CustomMedia),
    /// A `@layer` statement rule.
    LayerStatement(layer::LayerStatementRule),
    /// A `@layer` block rule.
    LayerBlock(layer::LayerBlockRule<'bump, R>),
    /// A `@property` rule.
    Property(property::PropertyRule),
    /// A `@container` rule.
    Container(container::ContainerRule<'bump, R>),
    /// A `@scope` rule.
    Scope(scope::ScopeRule<'bump, R>),
    /// A `@starting-style` rule.
    StartingStyle(starting_style::StartingStyleRule<'bump, R>),
    /// A placeholder for a rule that was removed.
    Ignored,
    /// An unknown at-rule.
    Unknown(unknown::UnknownAtRule),
    /// A custom at-rule.
    Custom(R),
}

impl<'bump, R> CssRule<'bump, R> {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            CssRule::Media(x) => x.to_css(dest),
            CssRule::Import(x) => x.to_css(dest),
            CssRule::Style(x) => x.to_css(dest),
            CssRule::Keyframes(x) => x.to_css(dest),
            CssRule::FontFace(x) => x.to_css(dest),
            CssRule::FontPaletteValues(x) => x.to_css(dest),
            CssRule::Page(x) => x.to_css(dest),
            CssRule::Supports(x) => x.to_css(dest),
            CssRule::CounterStyle(x) => x.to_css(dest),
            CssRule::Namespace(x) => x.to_css(dest),
            CssRule::MozDocument(x) => x.to_css(dest),
            CssRule::Nesting(x) => x.to_css(dest),
            CssRule::Viewport(x) => x.to_css(dest),
            CssRule::CustomMedia(x) => x.to_css(dest),
            CssRule::LayerStatement(x) => x.to_css(dest),
            CssRule::LayerBlock(x) => x.to_css(dest),
            CssRule::Property(x) => x.to_css(dest),
            CssRule::StartingStyle(x) => x.to_css(dest),
            CssRule::Container(x) => x.to_css(dest),
            CssRule::Scope(x) => x.to_css(dest),
            CssRule::Unknown(x) => x.to_css(dest),
            CssRule::Custom(x) => {
                // TODO(port): R needs a ToCss-like trait bound; Zig's anytype duck-typed here.
                x.to_css(dest).map_err(|_| dest.add_fmt_error())
            }
            CssRule::Ignored => Ok(()),
        }
    }

    pub fn deep_clone(&self, allocator: &'bump bun_alloc::Arena) -> Self {
        css::implement_deep_clone(self, allocator)
    }
}

// Zig: pub fn CssRuleList(comptime AtRule: type) type { return struct { ... } }
pub struct CssRuleList<'bump, R> {
    pub v: bumpalo::collections::Vec<'bump, CssRule<'bump, R>>,
}

impl<'bump, R> CssRuleList<'bump, R> {
    pub fn new_in(bump: &'bump bun_alloc::Arena) -> Self {
        Self { v: bumpalo::collections::Vec::new_in(bump) }
    }

    pub fn minify(&mut self, context: &mut MinifyContext<'_, 'bump>, parent_is_unused: bool) -> Result<(), css::MinifyErr> {
        // var keyframe_rules: keyframes.KeyframesName.HashMap(usize) = .{};
        // const layer_rules: layer.LayerName.HashMap(usize) = .{};
        // const property_rules: css.css_values.ident.DashedIdent.HashMap(usize) = .{};
        let mut style_rules: bun_collections::ArrayHashMap<StyleRuleKey<'_, 'bump, R>, usize> = bun_collections::ArrayHashMap::default();
        let mut rules: bumpalo::collections::Vec<'bump, CssRule<'bump, R>> =
            bumpalo::collections::Vec::new_in(context.allocator);

        for rule in self.v.iter_mut() {
            // NOTE Anytime you append to `rules` with this `rule`, you must set `moved_rule` to true.
            let mut moved_rule = false;
            // Zig: defer if (moved_rule) { rule.* = .ignored; };
            // Handled at the end of the loop body and at every `continue` point that set moved_rule.
            // PORT NOTE: reshaped for borrowck — Zig's defer-at-end-of-iteration is emulated by
            // assigning `*rule = CssRule::Ignored` immediately wherever the Zig moved out of `rule.*`.

            match rule {
                CssRule::Keyframes(_keyframez) => {
                    // if (context.unused_symbols.contains(switch (keyframez.name) {
                    //     .ident => |ident| ident.v,
                    //     .custom => |custom| custom,
                    // })) {
                    //     continue;
                    // }
                    //
                    // keyframez.minify(context);
                    //
                    // // Merge @keyframes rules with the same name.
                    // if (keyframe_rules.get(keyframez.name)) |existing_idx| {
                    //     if (existing_idx < rules.items.len and rules.items[existing_idx] == .keyframes) {
                    //         var existing = &rules.items[existing_idx].keyframes;
                    //         // If the existing rule has the same vendor prefixes, replace it with this rule.
                    //         if (existing.vendor_prefix.eq(keyframez.vendor_prefix)) {
                    //             existing.* = keyframez.clone(context.allocator);
                    //             continue;
                    //         }
                    //         // Otherwise, if the keyframes are identical, merge the prefixes.
                    //         if (existing.keyframes == keyframez.keyframes) {
                    //             existing.vendor_prefix |= keyframez.vendor_prefix;
                    //             existing.vendor_prefix = context.targets.prefixes(existing.vendor_prefix, css.prefixes.Feature.at_keyframes);
                    //             continue;
                    //         }
                    //     }
                    // }
                    //
                    // keyframez.vendor_prefix = context.targets.prefixes(keyframez.vendor_prefix, css.prefixes.Feature.at_keyframes);
                    // keyframe_rules.put(keyframez.name, rules.items.len);
                    //
                    // let fallbacks = keyframez.get_fallbacks::<R>(context.targets);
                    // moved_rule = true;
                    // rules.push(rule.*);
                    // rules.extend_from_slice(fallbacks);
                    // continue;
                    bun_output::scoped_log!(CSS_MINIFY, "TODO: KeyframesRule");
                }
                CssRule::CustomMedia(_) => {
                    if context.custom_media.is_some() {
                        continue;
                    }
                }
                CssRule::Media(med) => {
                    moved_rule = false;
                    // PORT NOTE: reshaped for borrowck — capture len before borrowing last_mut
                    let rules_len = rules.len();
                    if rules_len > 0 {
                        if let Some(CssRule::Media(last_rule)) = rules.last_mut() {
                            if last_rule.query.eql(&med.query) {
                                // PERF(port): was appendSlice on arena-fed list
                                last_rule.rules.v.extend(med.rules.v.drain(..));
                                let _ = last_rule.minify(context, parent_is_unused)?;
                                continue;
                            }
                        }
                    }
                    if med.minify(context, parent_is_unused)? {
                        continue;
                    }
                }
                CssRule::Supports(supp) => {
                    if let Some(CssRule::Supports(last_rule)) = rules.last() {
                        if last_rule.condition.eql(&supp.condition) {
                            continue;
                        }
                    }

                    supp.minify(context, parent_is_unused)?;
                    if supp.rules.v.is_empty() {
                        continue;
                    }
                }
                CssRule::Container(_cont) => {
                    bun_output::scoped_log!(CSS_MINIFY, "TODO: ContainerRule");
                }
                CssRule::LayerBlock(lay) => {
                    lay.rules.minify(context, parent_is_unused)?;
                    if lay.rules.v.is_empty() {
                        continue;
                    }
                }
                CssRule::LayerStatement(_lay) => {
                    bun_output::scoped_log!(CSS_MINIFY, "TODO: LayerStatementRule");
                }
                CssRule::MozDocument(_doc) => {
                    bun_output::scoped_log!(CSS_MINIFY, "TODO: MozDocumentRule");
                }
                CssRule::Style(sty) => {
                    use css::selector::Selector;
                    use css::selector::SelectorList;
                    use css::selector::Component;
                    bun_output::scoped_log!(
                        CSS_MINIFY,
                        "Input style:\n  Selectors: {}\n  Decls: {}\n",
                        sty.selectors.debug(),
                        sty.declarations.debug()
                    );
                    if parent_is_unused || sty.minify(context, parent_is_unused)? {
                        continue;
                    }

                    // If some of the selectors in this rule are not compatible with the targets,
                    // we need to either wrap in :is() or split them into multiple rules.
                    let mut incompatible: css::SmallList<css::selector::parser::Selector, 1> =
                        if sty.selectors.v.len() > 1
                            && context.targets.should_compile_selectors()
                            && !sty.is_compatible(*context.targets)
                        {
                            'incompatible: {
                                bun_output::scoped_log!(CSS_MINIFY, "Making incompatible!\n");
                                // The :is() selector accepts a forgiving selector list, so use that if possible.
                                // Note that :is() does not allow pseudo elements, so we need to check for that.
                                // In addition, :is() takes the highest specificity of its arguments, so if the selectors
                                // have different weights, we need to split them into separate rules as well.
                                if context.targets.is_compatible(css::compat::Feature::IsSelector)
                                    && !sty.selectors.any_has_pseudo_element()
                                    && sty.selectors.specifities_all_equal()
                                {
                                    let component = Component::Is(sty.selectors.v.to_owned_slice(context.allocator));
                                    let mut list = css::SmallList::<css::selector::parser::Selector, 1>::default();
                                    list.append(context.allocator, Selector::from_component(context.allocator, component));
                                    sty.selectors = SelectorList { v: list };
                                    break 'incompatible css::SmallList::<Selector, 1>::default();
                                } else {
                                    // Otherwise, partition the selectors and keep the compatible ones in this rule.
                                    // We will generate additional rules for incompatible selectors later.
                                    let mut incompatible = css::SmallList::<Selector, 1>::default();
                                    let mut i: u32 = 0;
                                    while (i as usize) < sty.selectors.v.len() {
                                        if css::selector::is_compatible(
                                            &sty.selectors.v.slice()[i as usize..i as usize + 1],
                                            *context.targets,
                                        ) {
                                            i += 1;
                                        } else {
                                            // Move the selector to the incompatible list.
                                            incompatible.append(
                                                context.allocator,
                                                sty.selectors.v.ordered_remove(i),
                                            );
                                        }
                                    }
                                    break 'incompatible incompatible;
                                }
                            }
                        } else {
                            css::SmallList::default()
                        };

                    sty.update_prefix(context);

                    // Attempt to merge the new rule with the last rule we added.
                    let mut merged = false;
                    // PORT NOTE: reshaped for borrowck — pattern-match last_mut instead of indexing
                    if let Some(CssRule::Style(last_style_rule)) = rules.last_mut() {
                        if merge_style_rules(sty, last_style_rule, context) {
                            // If that was successful, then the last rule has been updated to include the
                            // selectors/declarations of the new rule. This might mean that we can merge it
                            // with the previous rule, so continue trying while we have style rules available.
                            while rules.len() >= 2 {
                                let len = rules.len();
                                let (a, b) = rules.split_at_mut(len - 1);
                                if let (CssRule::Style(b0), CssRule::Style(a_prev)) = (&mut b[0], &mut a[len - 2]) {
                                    if merge_style_rules(b0, a_prev, context) {
                                        // If we were able to merge the last rule into the previous one, remove the last.
                                        let _popped = rules.pop();
                                        // TODO: deinit?
                                        continue;
                                    }
                                }
                                // If we didn't see a style rule, or were unable to merge, stop.
                                break;
                            }
                            merged = true;
                        }
                    }

                    // Create additional rules for logical properties, @supports overrides, and incompatible selectors.
                    let supps = context.handler_context.get_supports_rules::<R>(sty);
                    let logical = context.handler_context.get_additional_rules::<R>(sty);
                    bun_output::scoped_log!(CSS_MINIFY, "LOGICAL: {}\n", logical.len());
                    type StyleRule<'bump, R> = style::StyleRule<'bump, R>;

                    struct IncompatibleRuleEntry<'bump, R> {
                        rule: style::StyleRule<'bump, R>,
                        supports: bumpalo::collections::Vec<'bump, CssRule<'bump, R>>,
                        logical: bumpalo::collections::Vec<'bump, CssRule<'bump, R>>,
                    }
                    let mut incompatible_rules: css::SmallList<IncompatibleRuleEntry<'bump, R>, 1> = 'incompatible_rules: {
                        let mut incompatible_rules =
                            css::SmallList::<IncompatibleRuleEntry<'bump, R>, 1>::init_capacity(context.allocator, incompatible.len());

                        for sel in incompatible.slice_mut() {
                            // Create a clone of the rule with only the one incompatible selector.
                            // PORT NOTE: Zig moved `sel` by deref; here we take it by value via mem::take.
                            let list = SelectorList {
                                v: css::SmallList::<Selector, 1>::with_one(core::mem::take(sel)),
                            };
                            let mut clone: StyleRule<'bump, R> = style::StyleRule {
                                selectors: list,
                                vendor_prefix: sty.vendor_prefix,
                                declarations: sty.declarations.deep_clone(context.allocator),
                                rules: sty.rules.deep_clone(context.allocator),
                                loc: sty.loc,
                            };
                            clone.update_prefix(context);

                            // Also add rules for logical properties and @supports overrides.
                            let s = context.handler_context.get_supports_rules::<R>(&clone);
                            let l = context.handler_context.get_additional_rules::<R>(&clone);
                            incompatible_rules.append(
                                context.allocator,
                                IncompatibleRuleEntry { rule: clone, supports: s, logical: l },
                            );
                        }

                        break 'incompatible_rules incompatible_rules;
                    };
                    bun_output::scoped_log!(CSS_MINIFY, "Incompatible rules: {}\n", incompatible_rules.len());
                    // Zig: defer incompatible.deinit(context.allocator); — Drop handles this
                    // Zig: defer incompatible_rules.deinit(context.allocator); — Drop handles this

                    context.handler_context.reset();

                    // If the rule has nested rules, and we have extra rules to insert such as for logical properties,
                    // we need to split the rule in two so we can insert the extra rules in between the declarations from
                    // the main rule and the nested rules.
                    let nested_rule: Option<StyleRule<'bump, R>> = if !sty.rules.v.is_empty()
                        // can happen if there are no compatible rules, above.
                        && sty.selectors.v.len() > 0
                        && (!logical.is_empty() || !supps.is_empty() || !incompatible_rules.is_empty())
                    {
                        let mut rulesss: CssRuleList<'bump, R> = CssRuleList::new_in(context.allocator);
                        core::mem::swap(&mut sty.rules, &mut rulesss);
                        Some(style::StyleRule {
                            selectors: sty.selectors.deep_clone(context.allocator),
                            declarations: css::DeclarationBlock::default(),
                            rules: rulesss,
                            vendor_prefix: sty.vendor_prefix,
                            loc: sty.loc,
                        })
                    } else {
                        None
                    };

                    if !merged && !sty.is_empty() {
                        let source_index = sty.loc.source_index;
                        let has_no_rules = sty.rules.v.is_empty();
                        let idx = rules.len();

                        // PORT NOTE: reshaped for borrowck — move out of *rule via mem::replace
                        rules.push(core::mem::replace(rule, CssRule::Ignored));
                        moved_rule = true;

                        // Check if this rule is a duplicate of an earlier rule, meaning it has
                        // the same selectors and defines the same properties. If so, remove the
                        // earlier rule because this one completely overrides it.
                        if has_no_rules {
                            let key = StyleRuleKey::new(&rules, idx);
                            if idx > 0 {
                                if let Some(i) = style_rules.swap_remove(&key) {
                                    if i < rules.len() {
                                        if let CssRule::Style(other) = &rules[i] {
                                            // Don't remove the rule if this is a CSS module and the other rule came from a different file.
                                            if !context.css_modules || source_index == other.loc.source_index {
                                                // Only mark the rule as ignored so we don't need to change all of the indices.
                                                rules[i] = CssRule::Ignored;
                                            }
                                        }
                                    }
                                }
                            }

                            style_rules.insert(key, idx);
                        }
                    }

                    if !logical.is_empty() {
                        #[cfg(debug_assertions)]
                        if let CssRule::Style(s) = &logical[0] {
                            bun_output::scoped_log!(CSS_MINIFY, "Adding logical: {}\n", s.selectors.debug());
                        }
                        let mut log = CssRuleList { v: logical };
                        log.minify(context, parent_is_unused)?;
                        rules.extend(log.v);
                    }
                    rules.extend(supps);
                    for incompatible_entry in incompatible_rules.slice_mut() {
                        // PORT NOTE: reshaped for borrowck — move fields out via mem::replace (bumpalo Vec has no Default)
                        let entry_rule = core::mem::replace(
                            &mut incompatible_entry.rule,
                            // TODO(port): StyleRule placeholder — Zig moved by deref; need a cheap empty StyleRule::new_in(arena)
                            style::StyleRule::empty_in(context.allocator),
                        );
                        let entry_logical = core::mem::replace(
                            &mut incompatible_entry.logical,
                            bumpalo::collections::Vec::new_in(context.allocator),
                        );
                        let entry_supports = core::mem::replace(
                            &mut incompatible_entry.supports,
                            bumpalo::collections::Vec::new_in(context.allocator),
                        );
                        if !entry_rule.is_empty() {
                            rules.push(CssRule::Style(entry_rule));
                        }
                        if !entry_logical.is_empty() {
                            let mut log = CssRuleList { v: entry_logical };
                            log.minify(context, parent_is_unused)?;
                            rules.extend(log.v);
                        }
                        rules.extend(entry_supports);
                    }
                    if let Some(nested) = nested_rule {
                        rules.push(CssRule::Style(nested));
                    }

                    let _ = moved_rule; // see PORT NOTE at top of loop
                    continue;
                }
                CssRule::CounterStyle(_cntr) => {
                    bun_output::scoped_log!(CSS_MINIFY, "TODO: CounterStyleRule");
                }
                CssRule::Scope(_scpe) => {
                    bun_output::scoped_log!(CSS_MINIFY, "TODO: ScopeRule");
                }
                CssRule::Nesting(_nst) => {
                    bun_output::scoped_log!(CSS_MINIFY, "TODO: NestingRule");
                }
                CssRule::StartingStyle(_rl) => {
                    bun_output::scoped_log!(CSS_MINIFY, "TODO: StartingStyleRule");
                }
                CssRule::FontPaletteValues(_f) => {
                    bun_output::scoped_log!(CSS_MINIFY, "TODO: FontPaletteValuesRule");
                }
                CssRule::Property(_prop) => {
                    bun_output::scoped_log!(CSS_MINIFY, "TODO: PropertyRule");
                }
                _ => {}
            }

            // PORT NOTE: reshaped for borrowck — Zig: rules.append(rule.*); moved_rule = true; then defer sets rule.* = .ignored
            rules.push(core::mem::replace(rule, CssRule::Ignored));
            let _ = moved_rule;

            // Non-style rules (e.g. @property, @keyframes) act as a barrier for
            // style rule deduplication. We cannot safely merge identical style rules
            // across such boundaries because the intervening at-rule may affect how
            // the declarations are interpreted (e.g. @property defines a custom
            // property that a :root rule above may set differently than one below).
            style_rules.clear();
        }

        // MISSING SHIT HERE

        // Zig: css.deepDeinit(CssRule(AtRule), context.allocator, &this.v); — Drop handles freeing the old Vec
        self.v = rules;
        Ok(())
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        let mut first = true;
        let mut last_without_block = false;

        for rule in self.v.iter() {
            if matches!(rule, CssRule::Ignored) {
                continue;
            }

            // Skip @import rules if collecting dependencies.
            if let CssRule::Import(import_rule) = rule {
                if dest.remove_imports {
                    let dep = if dest.dependencies.is_some() {
                        Some(Dependency::Import(dependencies::ImportDependency::new(
                            dest.allocator,
                            import_rule,
                            dest.filename(),
                            dest.local_names,
                            dest.symbols,
                        )))
                    } else {
                        None
                    };

                    if let Some(deps) = dest.dependencies.as_mut() {
                        deps.push(dep.expect("unreachable"));
                        continue;
                    }
                }
            }

            if first {
                first = false;
            } else {
                if !dest.minify
                    && !(last_without_block
                        && matches!(rule, CssRule::Import(_) | CssRule::Namespace(_) | CssRule::LayerStatement(_)))
                {
                    dest.write_char('\n')?;
                }
                dest.newline()?;
            }
            rule.to_css(dest)?;
            last_without_block =
                matches!(rule, CssRule::Import(_) | CssRule::Namespace(_) | CssRule::LayerStatement(_));
        }
        Ok(())
    }

    pub fn deep_clone(&self, allocator: &'bump bun_alloc::Arena) -> Self {
        css::implement_deep_clone(self, allocator)
    }
}

pub struct MinifyContext<'a, 'bump> {
    /// NOTE: this should the same allocator the AST was allocated with
    pub allocator: &'bump bun_alloc::Arena,
    pub targets: &'a css::targets::Targets,
    pub handler: &'a mut css::DeclarationHandler,
    pub important_handler: &'a mut css::DeclarationHandler,
    pub handler_context: css::PropertyHandlerContext,
    // TODO(port): LIFETIMES.tsv says &'a HashSet<String>; Zig type is StringArrayHashMapUnmanaged(void) used as a set
    pub unused_symbols: &'a bun_collections::ArrayHashMap<Box<[u8]>, ()>,
    pub custom_media: Option<bun_collections::ArrayHashMap<Box<[u8]>, custom_media::CustomMediaRule>>,
    pub extra: &'a css::StylesheetExtra,
    pub css_modules: bool,
    pub err: Option<css::MinifyError>,
}

#[derive(Clone, Copy)]
pub struct Location {
    /// The index of the source file within the source map.
    pub source_index: u32,
    /// The line number, starting at 0.
    pub line: u32,
    /// The column number within a line, starting at 1 for first the character of the line.
    /// Column numbers are counted in UTF-16 code units.
    pub column: u32,
}

impl Location {
    pub fn dummy() -> Location {
        Location {
            source_index: u32::MAX,
            line: u32::MAX,
            column: u32::MAX,
        }
    }
}

pub struct StyleContext<'a> {
    pub selectors: &'a css::SelectorList,
    pub parent: Option<&'a StyleContext<'a>>,
}

/// A key to a StyleRule meant for use in a HashMap for quickly detecting duplicates.
/// It stores a reference to a list and an index so it can access items without cloning
/// even when the list is reallocated. A hash is also pre-computed for fast lookups.
pub struct StyleRuleKey<'a, 'bump, R> {
    pub list: &'a bumpalo::collections::Vec<'bump, CssRule<'bump, R>>,
    pub index: usize,
    // TODO: store in the hashmap by setting `store_hash` to true
    pub hash: u64,
}

impl<'a, 'bump, R> StyleRuleKey<'a, 'bump, R> {
    // Zig: pub fn HashMap(comptime V: type) type — in Rust, just use
    // bun_collections::ArrayHashMap<StyleRuleKey<'a, 'bump, R>, V> directly; Hash/Eq impls below
    // provide the custom hasher behavior.
    // TODO(port): Zig set store_hash=false; ArrayHashMap default may differ.

    pub fn new(list: &'a bumpalo::collections::Vec<'bump, CssRule<'bump, R>>, index: usize) -> Self {
        let rule = match &list[index] {
            CssRule::Style(s) => s,
            // SAFETY: caller guarantees list[index] is .style (mirrors Zig &list.items[index].style)
            _ => unreachable!(),
        };
        Self {
            list,
            index,
            hash: rule.hash_key(),
        }
    }

    pub fn eql(&self, other: &Self) -> bool {
        let rule = if self.index < self.list.len() {
            match &self.list[self.index] {
                CssRule::Style(s) => s,
                _ => return false,
            }
        } else {
            return false;
        };

        let other_rule = if other.index < other.list.len() {
            match &other.list[other.index] {
                CssRule::Style(s) => s,
                _ => return false,
            }
        } else {
            return false;
        };

        rule.is_duplicate(other_rule)
    }
}

impl<'a, 'bump, R> core::hash::Hash for StyleRuleKey<'a, 'bump, R> {
    fn hash<H: core::hash::Hasher>(&self, state: &mut H) {
        // Zig: @truncate(key.hash) to u32
        state.write_u32(self.hash as u32);
    }
}

impl<'a, 'bump, R> PartialEq for StyleRuleKey<'a, 'bump, R> {
    fn eq(&self, other: &Self) -> bool {
        self.eql(other)
    }
}

impl<'a, 'bump, R> Eq for StyleRuleKey<'a, 'bump, R> {}

fn merge_style_rules<'bump, T>(
    sty: &mut style::StyleRule<'bump, T>,
    last_style_rule: &mut style::StyleRule<'bump, T>,
    context: &mut MinifyContext<'_, 'bump>,
) -> bool {
    // Merge declarations if the selectors are equivalent, and both are compatible with all targets.
    // Does not apply if css modules are enabled
    if sty.selectors.eql(&last_style_rule.selectors)
        && sty.is_compatible(*context.targets)
        && last_style_rule.is_compatible(*context.targets)
        && sty.rules.v.is_empty()
        && last_style_rule.rules.v.is_empty()
        && (!context.css_modules || sty.loc.source_index == last_style_rule.loc.source_index)
    {
        // PERF(port): was appendSlice on arena-fed list
        last_style_rule
            .declarations
            .declarations
            .extend(sty.declarations.declarations.drain(..));
        // Zig: sty.declarations.declarations.clearRetainingCapacity(); — drain(..) above already cleared

        last_style_rule
            .declarations
            .important_declarations
            .extend(sty.declarations.important_declarations.drain(..));
        // Zig: sty.declarations.important_declarations.clearRetainingCapacity(); — drain(..) above already cleared

        last_style_rule.declarations.minify(
            context.handler,
            context.important_handler,
            &mut context.handler_context,
        );
        return true;
    } else if sty.declarations.eql(&last_style_rule.declarations)
        && sty.rules.v.is_empty()
        && last_style_rule.rules.v.is_empty()
    {
        // If both selectors are potentially vendor prefixable, and they are
        // equivalent minus prefixes, add the prefix to the last rule.
        if !sty.vendor_prefix.is_empty()
            && !last_style_rule.vendor_prefix.is_empty()
            && css::selector::is_equivalent(sty.selectors.v.slice(), last_style_rule.selectors.v.slice())
        {
            // If the new rule is unprefixed, replace the prefixes of the last rule.
            // Otherwise, add the new prefix.
            if sty.vendor_prefix.contains(css::VendorPrefix::NONE) && context.targets.should_compile_selectors() {
                last_style_rule.vendor_prefix = sty.vendor_prefix;
            } else {
                last_style_rule.vendor_prefix.insert(sty.vendor_prefix);
            }
            return true;
        }

        // Append the selectors to the last rule if the declarations are the same, and all selectors are compatible.
        if sty.is_compatible(*context.targets) && last_style_rule.is_compatible(*context.targets) {
            last_style_rule
                .selectors
                .v
                .append_slice(context.allocator, sty.selectors.v.slice());
            sty.selectors.v.clear_retaining_capacity();
            if sty.vendor_prefix.contains(css::VendorPrefix::NONE) && context.targets.should_compile_selectors() {
                last_style_rule.vendor_prefix = sty.vendor_prefix;
            } else {
                last_style_rule.vendor_prefix.insert(sty.vendor_prefix);
            }
            return true;
        }
    }
    false
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/rules.zig (681 lines)
//   confidence: medium
//   todos:      4
//   notes:      moved_rule defer reshaped via mem::replace; StyleRuleKey borrows &bumpalo::Vec while same Vec is mutated (Zig pattern) — Phase B must rework with raw ptr or index-only key; 'bump threaded through CssRule/CssRuleList (cascades to media/style/supports/etc. submodules — Phase B must add 'bump there)
// ──────────────────────────────────────────────────────────────────────────
