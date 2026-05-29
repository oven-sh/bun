use crate as css;

use css::PrintErr;
use css::Printer;
use css::error::MinifyErr;

// PERF(port): heap-backed shim — Zig used arena-backed `std.ArrayListUnmanaged`.
// TODO(refactor): thread `'bump` and replace this with `crate::generics::ArrayList<'bump, T>`
// (= `bun_alloc::ArenaVec`) crate-wide in one pass.
pub(super) type ArrayList<T> = Vec<T>;

pub mod container;
pub mod counter_style;
pub mod custom_media;
pub mod document;
pub mod font_face;
pub mod font_palette_values;
pub mod import;
pub mod keyframes;
pub mod layer;
pub mod media;
pub mod namespace;
pub mod nesting;
pub mod page;
pub mod property;
pub mod scope;
pub mod starting_style;
pub mod style;
pub mod supports;
pub mod tailwind;
pub mod unknown;
pub mod viewport;

macro_rules! css_rule_variants {
    ( $( $(#[$doc:meta])* $Variant:ident($Payload:ty) ),+ $(,)? ) => {
        /// A single CSS rule (at-rule or style rule).
        pub enum CssRule<R> {
            $( $(#[$doc])* $Variant($Payload), )+
            /// A placeholder for a rule that was removed.
            Ignored,
            /// An unknown at-rule.
            Unknown(unknown::UnknownAtRule),
            /// A custom at-rule.
            Custom(R),
        }

        impl<R> CssRule<R> {
            pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
                match self {
                    $( CssRule::$Variant(x) => x.to_css(dest), )+
                    CssRule::Unknown(x) => x.to_css(dest),
                    CssRule::Custom(_x) => Err(dest.add_fmt_error()),
                    CssRule::Ignored => Ok(()),
                }
            }

            pub fn deep_clone<'bump>(&self, bump: &'bump bun_alloc::Arena) -> Self
            where
                R: css::generics::DeepClone<'bump>,
            {
                #[allow(unused_imports)]
                use css::generics::DeepClone as _;
                match self {
                    $( CssRule::$Variant(x) => CssRule::$Variant(x.deep_clone(bump)), )+
                    CssRule::Unknown(x) => CssRule::Unknown(x.deep_clone(bump)),
                    CssRule::Custom(x) => CssRule::Custom(x.deep_clone(bump)),
                    CssRule::Ignored => CssRule::Ignored,
                }
            }
        }
    };
}

css_rule_variants! {
    /// A `@media` rule.
    Media(media::MediaRule<R>),
    /// An `@import` rule.
    Import(import::ImportRule),
    /// A style rule.
    Style(style::StyleRule<R>),
    /// A `@keyframes` rule.
    Keyframes(keyframes::KeyframesRule),
    /// A `@font-face` rule.
    FontFace(font_face::FontFaceRule),
    /// A `@font-palette-values` rule.
    FontPaletteValues(font_palette_values::FontPaletteValuesRule),
    /// A `@page` rule.
    Page(page::PageRule),
    /// A `@supports` rule.
    Supports(supports::SupportsRule<R>),
    /// A `@counter-style` rule.
    CounterStyle(counter_style::CounterStyleRule),
    /// A `@namespace` rule.
    Namespace(namespace::NamespaceRule),
    /// A `@-moz-document` rule.
    MozDocument(document::MozDocumentRule<R>),
    /// A `@nest` rule.
    Nesting(nesting::NestingRule<R>),
    /// A `@viewport` rule.
    Viewport(viewport::ViewportRule),
    /// A `@custom-media` rule.
    CustomMedia(custom_media::CustomMediaRule),
    /// A `@layer` statement rule.
    LayerStatement(layer::LayerStatementRule),
    /// A `@layer` block rule.
    LayerBlock(layer::LayerBlockRule<R>),
    /// A `@property` rule.
    Property(property::PropertyRule),
    /// A `@container` rule.
    Container(container::ContainerRule<R>),
    /// A `@scope` rule.
    Scope(scope::ScopeRule<R>),
    /// A `@starting-style` rule.
    StartingStyle(starting_style::StartingStyleRule<R>),
}

// SAFETY: the CSS AST contains `SmallList<T, N>` (raw `*mut T`) and
// `bun_alloc::ArenaVec<'bump, T>` (raw `NonNull<T>` + `&Bump`) deep in
// leaf rule payloads, both of which suppress the auto-traits. Those containers
// uniquely own their storage exactly like `Vec<T>`, and post-parse the tree is
// shared read-only across the bundler thread pool (mirrors Zig, which freely
// hands the arena-backed AST between threads). Thread-safety therefore follows
// `R`'s auto-traits.
unsafe impl<R: Send> Send for CssRule<R> {}
// SAFETY: see the `Send` impl above — uniquely-owned storage; `Sync` follows `R: Sync`.
unsafe impl<R: Sync> Sync for CssRule<R> {}

/// Zig: pub fn CssRuleList(comptime AtRule: type) type { return struct { ... } }
pub struct CssRuleList<R> {
    // PERF(port): was `bun_alloc::ArenaVec<'bump, CssRule<'bump, R>>`;
    // arena threading restored when leaf rules un-gate.
    pub v: Vec<CssRule<R>>,
}

// `CssRuleList<R>` is auto-`Send`/`Sync` via `Vec<CssRule<R>>` and the
// `CssRule<R>` impls above — no `unsafe impl` needed.

impl<R> Default for CssRuleList<R> {
    fn default() -> Self {
        Self { v: Vec::new() }
    }
}

pub(super) mod dc {
    use bun_alloc::Arena;

    #[inline]
    pub(crate) fn decl_block<'bump>(
        this: &crate::DeclarationBlock<'bump>,
        bump: &'bump Arena,
    ) -> crate::DeclarationBlock<'bump> {
        crate::DeclarationBlock {
            important_declarations: bun_alloc::vec_from_iter_in(
                this.important_declarations
                    .iter()
                    .map(|p| property(p, bump)),
                bump,
            ),
            declarations: bun_alloc::vec_from_iter_in(
                this.declarations.iter().map(|p| property(p, bump)),
                bump,
            ),
        }
    }

    /// `'bump`-erasure for the arena reference.
    ///
    /// SAFETY: `DeclarationBlock<'static>` is the crate-wide `'bump`-erasure
    /// placeholder until `CssRule<'bump, R>` re-threads the arena lifetime
    /// (see `style.rs` struct PORT NOTE). `bumpalo::Vec` is invariant in
    /// `'bump`, so any `DeclarationBlock<'static>` constructor must observe a
    /// `&'static Arena`. The arena outlives every rule that borrows it (it
    /// owns them); lifetimes re-thread together when the rule structs grow a
    /// real `'bump` parameter — at which point this helper and both callers
    /// below collapse to plain `decl_block` / `new_in`.
    #[inline(always)]
    unsafe fn arena_static(bump: &Arena) -> &'static Arena {
        // SAFETY: see fn doc — `'bump`-erasure placeholder.
        unsafe { &*core::ptr::from_ref(bump) }
    }

    /// `'bump`-erasure adaptor for [`decl_block`]. See [`arena_static`].
    #[inline]
    pub(crate) fn decl_block_static(
        this: &crate::DeclarationBlock<'static>,
        bump: &Arena,
    ) -> crate::DeclarationBlock<'static> {
        // SAFETY: `'bump`-erasure placeholder — see `arena_static`.
        decl_block(this, unsafe { arena_static(bump) })
    }

    #[inline]
    pub(crate) fn decl_block_empty_static(bump: &Arena) -> crate::DeclarationBlock<'static> {
        // SAFETY: `'bump`-erasure placeholder — see `arena_static`.
        crate::DeclarationBlock::new_in(unsafe { arena_static(bump) })
    }

    /// `'bump`-erasure adaptor for `&mut DeclarationHandler<'_>`.
    ///
    /// SAFETY: `DeclarationBlock<'static>` on `StyleRule` (see style.rs struct
    /// PORT NOTE) forces `DeclarationBlock::minify` to expect
    /// `DeclarationHandler<'static>`; the handlers in `MinifyContext` carry the
    /// real `'bump`. Both reference the same arena. Centralized here so the
    /// erasure lives in ONE place; collapses together with `decl_block_static`
    /// when `CssRule<'bump, R>` lands.
    #[inline]
    pub(crate) fn decl_handler_static<'a>(
        h: &'a mut crate::DeclarationHandler<'_>,
    ) -> &'a mut crate::DeclarationHandler<'static> {
        // SAFETY: inner-lifetime variance cast via raw pointer — `DeclarationHandler<'_>`
        // and `DeclarationHandler<'static>` share layout; only the borrowck tag on the
        // arena handle differs. See the fn doc SAFETY note above for the invariant.
        unsafe { &mut *core::ptr::from_mut(h).cast::<crate::DeclarationHandler<'static>>() }
    }

    /// `MediaList::deep_clone` — routes to the real arena-aware impl in
    /// media_query.rs (element-wise walk of `media_queries`).
    #[inline]
    pub(crate) fn media_list(
        this: &crate::media_query::MediaList,
        bump: &Arena,
    ) -> crate::media_query::MediaList {
        this.deep_clone(bump)
    }

    /// `SelectorList::deep_clone` re-derives the source `ArenaPtr` instead of
    /// taking `bump`; intra-arena only (footgun if a cross-arena clone is added).
    #[inline]
    pub(crate) fn selector_list(
        this: &crate::selectors::SelectorList,
        _bump: &Arena,
    ) -> crate::selectors::SelectorList {
        this.deep_clone()
    }

    /// `QueryFeature<F>::deep_clone` — routes to the real arena-aware impl in
    /// media_query.rs (variant-wise walk recursing into `MediaFeatureValue`).
    #[inline]
    pub(crate) fn query_feature<F>(
        this: &crate::media_query::QueryFeature<F>,
        bump: &Arena,
    ) -> crate::media_query::QueryFeature<F>
    where
        F: crate::media_query::FeatureIdTrait,
    {
        this.deep_clone(bump)
    }

    /// `Property::deep_clone` — routes to the real inherent
    /// `Property::deep_clone` in properties_generated.rs (faithful per-variant
    /// port of .zig:6307-6558).
    #[inline]
    pub(crate) fn property(
        this: &crate::properties::Property,
        bump: &Arena,
    ) -> crate::properties::Property {
        this.deep_clone(bump)
    }
}

/// Port of `DeclarationBlock.toCssBlock` (declaration.zig). The real impl is
/// gated in `declaration.rs`; `Property::to_css` is un-gated so the body is
/// trivially inlinable here.
pub(super) fn decl_block_to_css(
    decls: &css::DeclarationBlock<'_>,
    dest: &mut Printer,
) -> Result<(), PrintErr> {
    dest.whitespace()?;
    dest.write_char(b'{')?;
    dest.indent();

    let length = decls.len();
    let mut i: usize = 0;
    // Zig: `inline for (.{"declarations","important_declarations"}) |field|` — unrolled.
    for decl in decls.declarations.iter() {
        dest.newline()?;
        decl.to_css(dest, false)?;
        if i != length - 1 || !dest.minify {
            dest.write_char(b';')?;
        }
        i += 1;
    }
    for decl in decls.important_declarations.iter() {
        dest.newline()?;
        decl.to_css(dest, true)?;
        if i != length - 1 || !dest.minify {
            dest.write_char(b';')?;
        }
        i += 1;
    }

    dest.dedent();
    dest.newline()?;
    dest.write_char(b'}')
}

/// Port of `VendorPrefix.toCss` (css_parser.zig:182). Lives here because the
/// canonical `impl VendorPrefix` block in lib.rs hasn't grown a `to_css` yet
/// and `rules/` is the only un-gated caller.
#[inline]
pub(super) fn vendor_prefix_to_css(
    prefix: css::VendorPrefix,
    dest: &mut Printer,
) -> Result<(), PrintErr> {
    use css::VendorPrefix as VP;
    match prefix.bits() {
        b if b == VP::WEBKIT.bits() => dest.write_str("-webkit-"),
        b if b == VP::MOZ.bits() => dest.write_str("-moz-"),
        b if b == VP::MS.bits() => dest.write_str("-ms-"),
        b if b == VP::O.bits() => dest.write_str("-o-"),
        _ => Ok(()),
    }
}

#[inline]
pub(super) fn custom_ident_to_css(
    ident: &css::css_values::ident::CustomIdent,
    dest: &mut Printer,
) -> Result<(), PrintErr> {
    // SAFETY: CustomIdent.v points into the parser arena which outlives the AST.
    let v = unsafe { crate::arena_str(ident.v) };
    // blocked_on: Printer::write_ident — css-module custom-ident scoping path
    // is gated; fall through to its unscoped tail.

    let enabled = dest
        .css_module
        .as_ref()
        .is_some_and(|m| m.config.custom_idents);
    dest.write_ident(v, enabled)
}

#[inline]
pub(super) fn dashed_ident_to_css(
    ident: &css::css_values::ident::DashedIdent,
    dest: &mut Printer,
) -> Result<(), PrintErr> {
    let v = ident.v();
    dest.write_str("--")?;
    // blocked_on: Printer::write_dashed_ident — css-module dashed-ident scoping
    // path is gated; fall through to the unscoped tail it shares.
    dest.serialize_name(&v[2..])
}

impl<R> media::MediaRule<R> {
    pub fn minify(
        &mut self,
        context: &mut MinifyContext<'_, '_>,
        parent_is_unused: bool,
    ) -> Result<bool, MinifyErr>
    where
        R: for<'b> css::generics::DeepClone<'b>,
    {
        self.rules.minify(context, parent_is_unused)?;
        Ok(self.rules.v.is_empty() || self.query.never_matches())
    }
}

impl<R> CssRule<R> {
    pub(crate) fn is_deferred_to_final_prefix_pass(&self) -> bool {
        match self {
            CssRule::Style(style) => !style.vendor_prefix.is_empty(),
            CssRule::Nesting(nesting) => !nesting.style.vendor_prefix.is_empty(),
            _ => false,
        }
    }
}

// ─── CssRuleList::{to_css,minify,deep_clone} ──────────────────────────────

impl<R> CssRuleList<R> {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        let mut first = true;
        let mut last_without_block = false;

        for rule in self.v.iter() {
            if matches!(rule, CssRule::Ignored) {
                continue;
            }

            if dest.skip_prefixed_nested_rules && rule.is_deferred_to_final_prefix_pass() {
                continue;
            }

            // Skip @import rules if collecting dependencies.
            if let CssRule::Import(import_rule) = rule
                && dest.remove_imports
            {
                let dep = if dest.dependencies.is_some() {
                    Some(css::dependencies::Dependency::Import(
                        css::dependencies::ImportDependency::new(
                            dest.arena,
                            import_rule,
                            dest.filename(),
                            dest.local_names,
                            dest.symbols,
                        ),
                    ))
                } else {
                    None
                };

                if let Some(deps) = dest.dependencies.as_mut() {
                    if let Some(d) = dep {
                        deps.push(d);
                    }
                    continue;
                }
            }

            if first {
                first = false;
            } else {
                if !dest.minify
                    && !(last_without_block
                        && matches!(
                            rule,
                            CssRule::Import(_) | CssRule::Namespace(_) | CssRule::LayerStatement(_)
                        ))
                {
                    dest.write_char(b'\n')?;
                }
                dest.newline()?;
            }
            rule.to_css(dest)?;
            last_without_block = matches!(
                rule,
                CssRule::Import(_) | CssRule::Namespace(_) | CssRule::LayerStatement(_)
            );
        }
        Ok(())
    }

    pub fn minify(
        &mut self,
        context: &mut MinifyContext<'_, '_>,
        parent_is_unused: bool,
    ) -> Result<(), MinifyErr>
    where
        R: for<'b> css::generics::DeepClone<'b>,
    {
        let mut style_rules = StyleRuleKeyMap::default();
        let mut rules: Vec<CssRule<R>> = Vec::new();

        for rule in self.v.iter_mut() {
            // NOTE Anytime you push `rule` into `rules`, set `moved_rule = true`
            // so the source slot is replaced with `Ignored` (mirrors Zig's
            // `defer if (moved_rule) rule.* = .ignored`).
            let mut moved_rule = false;

            'arm: {
                match rule {
                    CssRule::Keyframes(_keyframez) => {
                        // TODO(port): KeyframesRule minify (unused-symbol drop +
                        // same-name merge + vendor-prefix downlevel + fallbacks).
                        // Zig leaves this as a debug-TODO fallthrough today.
                    }
                    CssRule::CustomMedia(_) => {
                        if context.custom_media.is_some() {
                            break 'arm;
                        }
                    }
                    CssRule::Media(med) => {
                        // blocked_on: MediaList::eql — merge-with-previous-@media.

                        if let Some(CssRule::Media(last_rule)) = rules.last_mut()
                            && last_rule.query.eql(&med.query)
                        {
                            last_rule.rules.v.append(&mut med.rules.v);
                            let _ = last_rule.minify(context, parent_is_unused)?;
                            break 'arm;
                        }
                        if med.minify(context, parent_is_unused)? {
                            break 'arm;
                        }
                    }
                    CssRule::Supports(supp) => {
                        // blocked_on: SupportsCondition::eql (gated in supports.rs).

                        if let Some(CssRule::Supports(last_rule)) = rules.last_mut()
                            && last_rule.condition.eql(&supp.condition)
                        {
                            // Zig drops the duplicate-condition rule outright.
                            break 'arm;
                        }
                        supp.minify(context, parent_is_unused)?;
                        if supp.rules.v.is_empty() {
                            break 'arm;
                        }
                    }
                    CssRule::Container(cont) => {
                        cont.rules.minify(context, parent_is_unused)?;
                    }
                    CssRule::LayerBlock(lay) => {
                        lay.rules.minify(context, parent_is_unused)?;
                        if lay.rules.v.is_empty() {
                            break 'arm;
                        }
                    }
                    CssRule::LayerStatement(_lay) => {
                        // TODO(port): LayerStatementRule minify — Zig fallthrough.
                    }
                    CssRule::MozDocument(doc) => {
                        // See `Container` above: recurse so nested style rules
                        // count against the selector-expansion cap.
                        doc.rules.minify(context, parent_is_unused)?;
                    }
                    CssRule::Style(_sty) => {
                        minify_style_arm(
                            rule,
                            &mut rules,
                            &mut style_rules,
                            context,
                            parent_is_unused,
                        )?;
                        break 'arm;
                    }
                    CssRule::CounterStyle(_) => { /* TODO(port): Zig fallthrough */ }
                    CssRule::Scope(scpe) => {
                        // See `Container` above: recurse so nested style rules
                        // count against the selector-expansion cap.
                        scpe.rules.minify(context, parent_is_unused)?;
                    }
                    CssRule::Nesting(nst) => {
                        nst.style.charge_selector_expansion(context)?;
                        nst.style.minify_nested_rules(context, parent_is_unused)?;
                    }
                    CssRule::StartingStyle(rl) => {
                        // See `Container` above: recurse so nested style rules
                        // count against the selector-expansion cap.
                        rl.rules.minify(context, parent_is_unused)?;
                    }
                    CssRule::FontPaletteValues(_) => { /* TODO(port): Zig fallthrough */ }
                    CssRule::Property(_) => { /* TODO(port): Zig fallthrough */ }
                    _ => {}
                }

                rules.push(core::mem::replace(rule, CssRule::Ignored));
                moved_rule = true;

                style_rules.clear();
            }

            if moved_rule {
                // PERF: leave the source slot as `Ignored` so any borrowed
                // sub-allocations can be reclaimed by the arena reset.
                *rule = CssRule::Ignored;
            }
        }

        // Zig: css.deepDeinit(CssRule(AtRule), context.arena, &this.v);
        // Rust drops the old Vec on assignment.
        self.v = rules;
        Ok(())
    }

    /// Zig: `css.implementDeepClone(@This(), this, arena)`.
    pub fn deep_clone<'bump>(&self, bump: &'bump bun_alloc::Arena) -> Self
    where
        R: css::generics::DeepClone<'bump>,
    {
        Self {
            v: self.v.iter().map(|r| r.deep_clone(bump)).collect(),
        }
    }
}

// ── `.style` arm body — preserved verbatim port, gated on StyleRule
// behavior + selector helpers + DeclarationBlock::deep_clone. ──

fn minify_style_arm<R: for<'b> css::generics::DeepClone<'b>>(
    rule: &mut CssRule<R>,
    rules: &mut Vec<CssRule<R>>,
    style_rules: &mut StyleRuleKeyMap,
    context: &mut MinifyContext<'_, '_>,
    parent_is_unused: bool,
) -> Result<(), MinifyErr> {
    use css::SmallList;
    use css::selector::{self, Component, Selector, SelectorList};
    let CssRule::Style(sty) = rule else {
        unreachable!()
    };

    if parent_is_unused || sty.minify(context, parent_is_unused)? {
        return Ok(());
    }

    // If some of the selectors in this rule are not compatible with the targets,
    // we need to either wrap in :is() or split them into multiple rules.
    let mut incompatible: SmallList<Selector, 1> = if sty.selectors.v.len() > 1
        && context.targets.should_compile_selectors()
        && !sty.is_compatible(context.targets)
    {
        if context
            .targets
            .is_compatible(css::compat::Feature::IsSelector)
            && !sty.selectors.any_has_pseudo_element()
            && sty.selectors.specifities_all_equal()
        {
            let component = Component::Is(core::mem::take(&mut sty.selectors.v).to_owned_slice());
            let mut list = SmallList::<Selector, 1>::default();
            list.append(Selector::from_component(component));
            sty.selectors = SelectorList { v: list };
            SmallList::default()
        } else {
            // Otherwise, partition the selectors and keep the compatible ones in this rule.
            // We will generate additional rules for incompatible selectors later.
            let mut incompatible = SmallList::<Selector, 1>::default();
            let mut i: u32 = 0;
            while i < sty.selectors.v.len() {
                if selector::is_compatible(
                    &sty.selectors.v.slice()[i as usize..i as usize + 1],
                    context.targets,
                ) {
                    i += 1;
                } else {
                    incompatible.append(sty.selectors.v.ordered_remove(i));
                }
            }
            incompatible
        }
    } else {
        SmallList::default()
    };

    sty.update_prefix(context);

    // Attempt to merge the new rule with the last rule we added.
    let mut merged = false;
    if let Some(CssRule::Style(last_style_rule)) = rules.last_mut()
        && merge_style_rules(sty, last_style_rule, context)
    {
        // If that was successful, then the last rule has been updated to include the
        // selectors/declarations of the new rule. This might mean that we can merge it
        // with the previous rule, so continue trying while we have style rules available.
        while rules.len() >= 2 {
            let len = rules.len();
            let (a, b) = rules.split_at_mut(len - 1);
            if let (CssRule::Style(prev), CssRule::Style(last)) = (&mut a[len - 2], &mut b[0])
                && merge_style_rules(last, prev, context)
            {
                rules.pop();
                continue;
            }
            break;
        }
        merged = true;
    }

    // Create additional rules for logical properties, @supports overrides, and incompatible selectors.
    let supps = context.handler_context.get_supports_rules::<R>(sty);
    let logical = context.handler_context.get_additional_rules::<R>(sty);

    struct IncompatibleRuleEntry<R> {
        rule: style::StyleRule<R>,
        supports: Vec<CssRule<R>>,
        logical: Vec<CssRule<R>>,
    }
    let mut incompatible_rules: SmallList<IncompatibleRuleEntry<R>, 1> =
        SmallList::init_capacity(incompatible.len());
    while incompatible.len() > 0 {
        let sel = incompatible.ordered_remove(0);
        let list = SelectorList {
            v: SmallList::with_one(sel),
        };
        let mut clone = style::StyleRule::<R> {
            selectors: list,
            vendor_prefix: sty.vendor_prefix,
            declarations: dc::decl_block_static(&sty.declarations, context.arena),
            rules: sty.rules.deep_clone(context.arena),
            loc: sty.loc,
        };
        clone.update_prefix(context);
        let s = context.handler_context.get_supports_rules::<R>(&clone);
        let l = context.handler_context.get_additional_rules::<R>(&clone);
        incompatible_rules.append(IncompatibleRuleEntry {
            rule: clone,
            supports: s,
            logical: l,
        });
    }

    context.handler_context.reset();

    // If the rule has nested rules, and we have extra rules to insert such as for logical properties,
    // we need to split the rule in two so we can insert the extra rules in between the declarations from
    // the main rule and the nested rules.
    let nested_rule: Option<style::StyleRule<R>> = if !sty.rules.v.is_empty()
        && sty.selectors.v.len() > 0
        && (!logical.is_empty() || !supps.is_empty() || !incompatible_rules.is_empty())
    {
        let mut rulesss = CssRuleList::<R>::default();
        core::mem::swap(&mut sty.rules, &mut rulesss);
        // Zig: `.declarations = css.DeclarationBlock{}` — empty block. Route
        // through the centralized `'bump`-erasure helper instead of fabricating
        // `&'static Arena` here (PORTING.md §Forbidden).
        Some(style::StyleRule {
            selectors: sty.selectors.deep_clone(),
            declarations: dc::decl_block_empty_static(context.arena),
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

        rules.push(core::mem::replace(rule, CssRule::Ignored));

        // Check if this rule is a duplicate of an earlier rule, meaning it has
        // the same selectors and defines the same properties. If so, remove the
        // earlier rule because this one completely overrides it.
        if has_no_rules {
            let key = StyleRuleKey::new(rules, idx);
            if idx > 0
                && let Some(i) = style_rules.remove_duplicate(rules, &key)
                && i < rules.len()
                && let CssRule::Style(other) = &rules[i]
                && (!context.css_modules || source_index == other.loc.source_index)
            {
                rules[i] = CssRule::Ignored;
            }
            style_rules.insert(key);
        }
    }

    if !logical.is_empty() {
        let mut log = CssRuleList { v: logical };
        log.minify(context, parent_is_unused)?;
        rules.append(&mut log.v);
    }
    rules.extend(supps);
    while incompatible_rules.len() > 0 {
        let entry = incompatible_rules.ordered_remove(0);
        if !entry.rule.is_empty() {
            rules.push(CssRule::Style(entry.rule));
        }
        if !entry.logical.is_empty() {
            let mut log = CssRuleList { v: entry.logical };
            log.minify(context, parent_is_unused)?;
            rules.append(&mut log.v);
        }
        rules.extend(entry.supports);
    }
    if let Some(nested) = nested_rule {
        rules.push(CssRule::Style(nested));
    }

    Ok(())
}

#[derive(Clone, Copy)]
pub(crate) struct StyleRuleKey {
    index: usize,
    hash: u64,
}

impl StyleRuleKey {
    pub(crate) fn new<R>(list: &[CssRule<R>], index: usize) -> Self {
        let hash = match &list[index] {
            CssRule::Style(rule) => rule.hash_key(),
            _ => 0,
        };
        Self { index, hash }
    }
}

#[derive(Default)]
pub(crate) struct StyleRuleKeyMap {
    buckets: bun_collections::HashMap<u64, Vec<usize>>,
}

impl StyleRuleKeyMap {
    /// Zig `style_rules.fetchSwapRemove(key)` — find and remove an earlier
    /// index whose rule `is_duplicate` of `rules[key.index]`.
    pub(crate) fn remove_duplicate<R>(
        &mut self,
        rules: &[CssRule<R>],
        key: &StyleRuleKey,
    ) -> Option<usize> {
        let bucket = self.buckets.get_mut(&key.hash)?;
        let CssRule::Style(rule) = &rules[key.index] else {
            return None;
        };
        let pos = bucket.iter().position(|&other_idx| {
            // Mirrors `StyleRuleKey.eql` from rules.zig: bounds-check + .style
            // tag-check + `isDuplicate`.
            match rules.get(other_idx) {
                Some(CssRule::Style(other_rule)) => rule.is_duplicate(other_rule),
                _ => false,
            }
        })?;
        Some(bucket.swap_remove(pos))
    }

    /// Zig `style_rules.put(ctx.arena, key, idx)`.
    pub(crate) fn insert(&mut self, key: StyleRuleKey) {
        self.buckets.entry(key.hash).or_default().push(key.index);
    }

    pub(crate) fn clear(&mut self) {
        self.buckets.clear();
    }
}

// ─── merge_style_rules ─────────────────────────────────────────────────────

/// Merge `sty` into `last_style_rule` if their selectors/declarations allow.
/// Returns `true` if merged (caller should drop `sty`).
pub(crate) fn merge_style_rules<R>(
    sty: &mut style::StyleRule<R>,
    last_style_rule: &mut style::StyleRule<R>,
    context: &mut MinifyContext<'_, '_>,
) -> bool {
    use css::VendorPrefix;
    // Merge declarations if the selectors are equivalent, and both are compatible with all targets.
    // Does not apply if css modules are enabled.
    if sty.selectors.eql(&last_style_rule.selectors)
        && sty.is_compatible(context.targets)
        && last_style_rule.is_compatible(context.targets)
        && sty.rules.v.is_empty()
        && last_style_rule.rules.v.is_empty()
        && (!context.css_modules || sty.loc.source_index == last_style_rule.loc.source_index)
    {
        last_style_rule
            .declarations
            .declarations
            .extend(sty.declarations.declarations.drain(..));
        last_style_rule
            .declarations
            .important_declarations
            .extend(sty.declarations.important_declarations.drain(..));
        last_style_rule.declarations.minify(
            dc::decl_handler_static(&mut *context.handler),
            dc::decl_handler_static(&mut *context.important_handler),
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
            && css::selector::is_equivalent(
                sty.selectors.v.slice(),
                last_style_rule.selectors.v.slice(),
            )
        {
            if sty.vendor_prefix.contains(VendorPrefix::NONE)
                && context.targets.should_compile_selectors()
            {
                last_style_rule.vendor_prefix = sty.vendor_prefix;
            } else {
                last_style_rule.vendor_prefix.insert(sty.vendor_prefix);
            }
            return true;
        }

        // Append the selectors to the last rule if the declarations are the same, and all selectors are compatible.
        if sty.is_compatible(context.targets) && last_style_rule.is_compatible(context.targets) {
            let moved = core::mem::take(&mut sty.selectors.v);
            // `reserve` (not `ensure_total_capacity`) so capacity grows
            // super-linearly across repeated merges — matches .zig
            // `appendSlice` and keeps the N-way merge amortized O(N).
            last_style_rule.selectors.v.reserve(moved.len());
            for sel in moved {
                last_style_rule.selectors.v.append_assume_capacity(sel);
            }
            if sty.vendor_prefix.contains(VendorPrefix::NONE)
                && context.targets.should_compile_selectors()
            {
                last_style_rule.vendor_prefix = sty.vendor_prefix;
            } else {
                last_style_rule.vendor_prefix.insert(sty.vendor_prefix);
            }
            return true;
        }
    }
    false
}

// ─── Location / StyleContext / MinifyContext ──────────────────────────────

// Zig spec: `css.Location = css_rules.Location` is a TYPE ALIAS (one nominal
// type). Re-export the crate-root struct so `css_rules::Location` and
// `crate::Location` are interchangeable.
pub use crate::Location;

/// Printer's nesting cursor — linked list of parent selector lists used to
/// resolve `&` during serialization.
pub struct StyleContext<'a> {
    pub selectors: &'a crate::selectors::SelectorList,
    pub parent: Option<&'a StyleContext<'a>>,
}

pub const MAX_SELECTOR_EXPANSION: u32 = 65_536;

pub struct MinifyContext<'a, 'bump> {
    /// Arena that owns the AST being minified (same arena it was parsed into).
    pub arena: &'bump bun_alloc::Arena,
    pub targets: &'a css::targets::Targets,
    pub handler: &'a mut css::DeclarationHandler<'bump>,
    pub important_handler: &'a mut css::DeclarationHandler<'bump>,
    pub handler_context: css::PropertyHandlerContext<'bump>,
    pub unused_symbols: &'a bun_collections::ArrayHashMap<Box<[u8]>, ()>,
    /// Pre-scanned `@custom-media` definitions, if the feature is enabled.
    pub custom_media:
        Option<bun_collections::ArrayHashMap<Box<[u8]>, custom_media::CustomMediaRule>>,
    pub extra: &'a css::StylesheetExtra,
    pub css_modules: bool,
    /// First minification error encountered (Zig surfaced this out-of-band).
    pub err: Option<css::error::MinifyError>,
    /// How many copies of the current rule's selectors compiling the enclosing
    /// nesting for the targets will produce — the product of the enclosing
    /// style rules' selector-list lengths. `1` at the top level.
    pub selector_expansion_multiplier: u32,
    /// Running total of selectors that compiling nested rules for the targets
    /// will expand to, checked against [`MAX_SELECTOR_EXPANSION`].
    pub selector_expansion_total: u32,
}

// ported from: src/css/rules/rules.zig
