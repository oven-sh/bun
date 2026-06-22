use crate as css;

use css::PrintErr;
use css::Printer;
use css::error::MinifyErr;

// PERF: heap-backed shim.
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

// ─── CssRule / CssRuleList ─────────────────────────────────────────────────
// An earlier iteration threaded a `'bump` arena lifetime through every rule.
// That cascades into every leaf module signature, so `CssRule<R>` is kept
// lifetime-free here.

// ─── CssRule variant table ────────────────────────────────────────────────
// Single source of truth for the 20 typed at-rule payloads. Adding a new
// at-rule = one line here; the enum variant + `to_css` arm + `deep_clone`
// arm are generated. `Unknown`/`Custom`/`Ignored` stay a fixed tail because
// their `to_css` arms are special-cased (see the note on `Custom`).
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
                    // There are TWO concrete `R` types — `DefaultAtRule` (whose
                    // `to_css` errors unconditionally) and `TailwindAtRule`,
                    // whose `to_css` succeeds and writes `@tailwind <name>;`.
                    // Tailwind parsing is disabled (`ENABLE_TAILWIND_PARSING =
                    // false`, `BundlerAtRule = DefaultAtRule` in css_parser.rs),
                    // so erroring here is correct for every `R` that is
                    // actually instantiated. If
                    // `TailwindAtRule` is ever enabled, thread a `ToCss`-style bound
                    // (or per-`R` vtable) so `Custom(x)` dispatches to
                    // `x.to_css(dest)` and only the error path maps through
                    // `add_fmt_error()`; that bound cascades through every nested
                    // `CssRuleList<R>` printer (media, supports, layer, document,
                    // nesting, starting_style, style, scope, container).
                    CssRule::Custom(_x) => Err(dest.add_fmt_error()),
                    CssRule::Ignored => Ok(()),
                }
            }

            /// Variant-wise dispatch to each leaf rule's `deep_clone`. Hand-written (not
            /// `#[derive(DeepClone)]`) because the leaf payloads expose `deep_clone`
            /// as **inherent** methods rather than `DeepClone` trait impls;
            /// method-syntax dispatch here picks up either.
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
// shared read-only across the bundler thread pool. Thread-safety therefore
// follows `R`'s auto-traits.
unsafe impl<R: Send> Send for CssRule<R> {}
// SAFETY: see the `Send` impl above — uniquely-owned storage; `Sync` follows `R: Sync`.
unsafe impl<R: Sync> Sync for CssRule<R> {}

/// Ordered list of CSS rules, generic over the custom at-rule type `R`.
pub struct CssRuleList<R> {
    // PERF: re-thread to `bun_alloc::ArenaVec<'bump, CssRule<'bump, R>>`.
    pub v: Vec<CssRule<R>>,
}

// `CssRuleList<R>` is auto-`Send`/`Sync` via `Vec<CssRule<R>>` and the
// `CssRule<R>` impls above — no `unsafe impl` needed.

impl<R> Default for CssRuleList<R> {
    fn default() -> Self {
        Self { v: Vec::new() }
    }
}

// ─── leaf-rule deep_clone ──────────────────────────────────────────────────
// Every leaf module now owns a real inherent `deep_clone` body — the field-
// wise / variant-wise port of `css.implementDeepClone`. `CssRule::deep_clone`
// (below) dispatches via method-syntax so it picks up the inherent impl.
//
// Most leaf rules can't use `#[derive(DeepClone)]` directly because
// `SelectorList` uses a no-arg `deep_clone()`. The leaf bodies hand-roll the
// field walk and route those fields through the `dc::*` passthroughs below.
// Once an upstream type grows its own `deep_clone(&self, &Arena)`, swap the
// `dc::foo(&x, bump)` call for `x.deep_clone(bump)` and delete the helper.
pub(super) mod dc {
    use bun_alloc::Arena;

    /// `DeclarationBlock::deep_clone` — field-walk over both
    /// `DeclarationList`s, routing each `Property` through `dc::property`.
    ///
    /// Threads the real `'bump` lifetime instead of fabricating
    /// `'static` (PORTING.md §Forbidden: `unsafe { &*(p as *const _) }` to
    /// extend a lifetime). Callers whose storage is still pinned to
    /// `DeclarationBlock<'static>` must fix that storage type — the lie
    /// belongs there, not here, and collapses when `CssRule<'bump, R>`
    /// re-threads the arena lifetime.
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
    /// (see the note on `StyleRule.declarations` in `style.rs`). `bumpalo::Vec` is invariant in
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

    /// Empty `DeclarationBlock<'static>`.
    ///
    /// Exists so call-sites that need an empty block route through ONE
    /// centralized erasure helper. Delete with `decl_block_static` once
    /// `CssRule<'bump, R>` re-threads the arena lifetime.
    #[inline]
    pub(crate) fn decl_block_empty_static(bump: &Arena) -> crate::DeclarationBlock<'static> {
        // SAFETY: `'bump`-erasure placeholder — see `arena_static`.
        crate::DeclarationBlock::new_in(unsafe { arena_static(bump) })
    }

    /// `'bump`-erasure adaptor for `&mut DeclarationHandler<'_>`.
    ///
    /// SAFETY: `DeclarationBlock<'static>` on `StyleRule` (see the note on
    /// `StyleRule.declarations` in style.rs) forces `DeclarationBlock::minify` to expect
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
    /// `Property::deep_clone` in properties_generated.rs.
    #[inline]
    pub(crate) fn property(
        this: &crate::properties::Property,
        bump: &Arena,
    ) -> crate::properties::Property {
        this.deep_clone(bump)
    }
}

// `Location` is plain `Copy` data; the derive expands to field-wise
// `u32::deep_clone` (identity). Doubles as the in-tree smoke test that the
// `#[derive(DeepClone)]` proc-macro round-trips through a real CSS type.

// ─── shared serialization helpers for leaf rules ──────────────────────────

/// `DeclarationBlock` block serialization.
pub(super) fn decl_block_to_css(
    decls: &css::DeclarationBlock<'_>,
    dest: &mut Printer,
) -> Result<(), PrintErr> {
    dest.whitespace()?;
    dest.write_char(b'{')?;
    dest.indent();

    let length = decls.len();
    let mut i: usize = 0;
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

/// `VendorPrefix` serialization. Lives here because the
/// canonical `impl VendorPrefix` block in lib.rs hasn't grown a `to_css`
/// yet and `rules/` is the only caller.
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

/// Port of `CustomIdentFns.toCss` → `Printer.writeIdent` with CSS-module
/// custom-ident scoping.
#[inline]
pub(super) fn custom_ident_to_css(
    ident: &css::css_values::ident::CustomIdent,
    dest: &mut Printer,
) -> Result<(), PrintErr> {
    // SAFETY: CustomIdent.v points into the parser arena which outlives the AST.
    let v = unsafe { crate::arena_str(ident.v) };
    let enabled = dest
        .css_module
        .as_ref()
        .is_some_and(|m| m.config.custom_idents);
    dest.write_ident(v, enabled)
}

/// Port of `DashedIdentFns.toCss` → `Printer.writeDashedIdent`. The
/// non-css-module path (the only one any current rule reaches) is
/// `--` + `serialize_name(rest)`.
#[inline]
pub(super) fn dashed_ident_to_css(
    ident: &css::css_values::ident::DashedIdent,
    dest: &mut Printer,
) -> Result<(), PrintErr> {
    let v = ident.v();
    dest.write_str("--")?;
    dest.serialize_name(&v[2..])
}

/// Recurse into the nested list and report whether the rule should be
/// dropped. NOTE: `never_matches()` is a *drop condition*, not merely an
/// optimization — omitting it diverges output (e.g. `@media not all
/// { a{color:red} }` must be removed).
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
    /// Whether this rule is skipped while `Printer::skip_prefixed_nested_rules`
    /// is set (a non-final vendor prefix pass of an ancestor style rule) and
    /// emitted only in the ancestor's final pass: a style rule with its own
    /// vendor prefixes overrides `Printer::vendor_prefix`, so its output is
    /// identical in every ancestor pass.
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

            // While re-serializing nested rules for a non-final vendor prefix
            // pass of an ancestor style rule, skip style rules that carry
            // their own vendor prefixes: they override `dest.vendor_prefix`,
            // so this pass would emit an exact duplicate of what the final
            // pass emits.
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
        let mut merge_state = StyleRuleMergeState::default();
        let mut rules: Vec<CssRule<R>> = Vec::new();

        for rule in self.v.iter_mut() {
            // NOTE Anytime you push `rule` into `rules`, set `moved_rule = true`
            // so the source slot is replaced with `Ignored`.
            let mut moved_rule = false;

            'arm: {
                match rule {
                    CssRule::Keyframes(_keyframez) => {
                        // KeyframesRule minify (unused-symbol drop + same-name
                        // merge + vendor-prefix downlevel + fallbacks) is
                        // not implemented; fall through.
                    }
                    CssRule::CustomMedia(_) => {
                        if context.custom_media.is_some() {
                            break 'arm;
                        }
                    }
                    CssRule::Media(med) => {
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
                        if let Some(CssRule::Supports(last_rule)) = rules.last_mut()
                            && last_rule.condition.eql(&supp.condition)
                        {
                            // Drop the duplicate-condition rule outright.
                            break 'arm;
                        }
                        supp.minify(context, parent_is_unused)?;
                        if supp.rules.v.is_empty() {
                            break 'arm;
                        }
                    }
                    CssRule::Container(cont) => {
                        // The condition-merge/dedup port is still pending, but the
                        // nested rules must be minified so the nesting-away
                        // selector expansion stays bounded by
                        // `MAX_SELECTOR_EXPANSION` — otherwise an at-rule between
                        // two nesting levels hides the inner levels from the cap
                        // and the printer expands them exponentially.
                        cont.rules.minify(context, parent_is_unused)?;
                    }
                    CssRule::LayerBlock(lay) => {
                        lay.rules.minify(context, parent_is_unused)?;
                        if lay.rules.v.is_empty() {
                            break 'arm;
                        }
                    }
                    CssRule::LayerStatement(_lay) => {
                        // LayerStatementRule minify is not implemented; fall through.
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
                            &mut merge_state,
                            context,
                            parent_is_unused,
                        )?;
                        break 'arm;
                    }
                    CssRule::CounterStyle(_) => {}
                    CssRule::Scope(scpe) => {
                        // See `Container` above: recurse so nested style rules
                        // count against the selector-expansion cap.
                        scpe.rules.minify(context, parent_is_unused)?;
                    }
                    CssRule::Nesting(nst) => {
                        // See `Container` above. `@nest` wraps a single style
                        // rule whose own selectors also form a nesting level, so
                        // charge them against the cap and recurse into its nested
                        // rules with the multiplier bumped accordingly.
                        //
                        // Deliberately does NOT run `StyleRule::minify` on the
                        // wrapped rule: that would feed its declarations through
                        // the property handlers, which consume logical properties
                        // (staging LTR/RTL fallbacks in the handler context) that
                        // the `@nest` minify port does not yet drain — silently
                        // dropping the declaration. Leaving the declarations
                        // untouched preserves them verbatim, matching the
                        // pre-port behavior.
                        nst.style.charge_selector_expansion(context)?;
                        nst.style.minify_nested_rules(context, parent_is_unused)?;
                    }
                    CssRule::StartingStyle(rl) => {
                        // See `Container` above: recurse so nested style rules
                        // count against the selector-expansion cap.
                        rl.rules.minify(context, parent_is_unused)?;
                    }
                    CssRule::FontPaletteValues(_) => {}
                    CssRule::Property(_) => {}
                    _ => {}
                }

                // Appending a non-style rule ends the current style-rule merge
                // run, so settle any pending declaration merge first.
                flush_pending_style_merge(&mut rules, &mut merge_state, context);
                merge_state.last_compat = None;
                rules.push(core::mem::replace(rule, CssRule::Ignored));
                moved_rule = true;

                // Non-style rules act as a barrier for style-rule dedup —
                // an intervening at-rule may change how declarations are
                // interpreted, so identical selectors on either side aren't
                // safely mergeable.

                style_rules.clear();
            }

            if moved_rule {
                // PERF: leave the source slot as `Ignored` so any borrowed
                // sub-allocations can be reclaimed by the arena reset.
                *rule = CssRule::Ignored;
            }
        }

        // The last merge run may still have a pending declaration merge.
        flush_pending_style_merge(&mut rules, &mut merge_state, context);

        // The old Vec is dropped on assignment.
        self.v = rules;
        Ok(())
    }

    pub fn deep_clone<'bump>(&self, bump: &'bump bun_alloc::Arena) -> Self
    where
        R: css::generics::DeepClone<'bump>,
    {
        Self {
            v: self.v.iter().map(|r| r.deep_clone(bump)).collect(),
        }
    }
}

fn minify_style_arm<R: for<'b> css::generics::DeepClone<'b>>(
    rule: &mut CssRule<R>,
    rules: &mut Vec<CssRule<R>>,
    style_rules: &mut StyleRuleKeyMap,
    merge_state: &mut StyleRuleMergeState,
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
        // The :is() selector accepts a forgiving selector list, so use that if possible.
        // Note that :is() does not allow pseudo elements, so we need to check for that.
        // In addition, :is() takes the highest specificity of its arguments, so if the selectors
        // have different weights, we need to split them into separate rules as well.
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

    // The declaration merge below drains `sty.declarations`, but the rules
    // built for the partitioned-out incompatible selectors clone it after the
    // merge. Snapshot it first, or a merge would silently drop the
    // incompatible selectors' styling.
    let incompatible_decls: Option<css::DeclarationBlock> = if incompatible.len() > 0 {
        Some(dc::decl_block_static(&sty.declarations, context.arena))
    } else {
        None
    };

    // Attempt to merge the new rule with the last rule we added.
    let mut merged = false;
    let mut sty_compat: Option<bool> = None;
    let had_pending = merge_state.pending_minify;
    if let Some(CssRule::Style(last_style_rule)) = rules.last_mut()
        && merge_style_rules(
            sty,
            last_style_rule,
            context,
            &mut merge_state.pending_minify,
            &mut sty_compat,
            &mut merge_state.last_compat,
        )
    {
        // If that was successful, then the last rule has been updated to include the
        // selectors/declarations of the new rule. This might mean that we can merge it
        // with the previous rule, so continue trying while we have style rules available.
        // A declaration merge defers both the re-minify and this cascade to
        // the end of the merge run (see `flush_pending_style_merge`).
        if !merge_state.pending_minify {
            cascade_merge_with_previous(rules, merge_state, context);
        }
        merged = true;
    }

    if !merged && had_pending {
        // The failed merge settled the previous run's pending declarations
        // (merge_style_rules re-minifies before its declaration comparison);
        // run the merge-with-previous cascade that settling enables, which the
        // per-merge re-minify used to drive at the end of that run.
        debug_assert!(!merge_state.pending_minify);
        cascade_merge_with_previous(rules, merge_state, context);
        // A selector merge in the cascade can make the next pair's selectors
        // equal and start a new declaration merge, which the cascade returns
        // on. Settle it now: `sty` is pushed below, which would bury the
        // pending rule one slot down where no later flush can find it.
        flush_pending_style_merge(rules, merge_state, context);
    }

    // If this iteration staged handler-context rules (e.g. the merged-in rule
    // carried a `color-scheme` declaration needing dark-mode fallback vars),
    // settle the pending merge before collecting those rules below: the
    // re-minify re-runs the staging declarations and stages their rules
    // again, and the per-merge re-minify this replaces also ran before
    // collection, so the re-staged entries belong in this rule's extras.
    if merge_state.pending_minify
        && !(context.handler_context.supports.is_empty()
            && context.handler_context.ltr.is_empty()
            && context.handler_context.rtl.is_empty()
            && context.handler_context.dark.is_empty())
    {
        flush_pending_style_merge(rules, merge_state, context);
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
            declarations: dc::decl_block_static(
                incompatible_decls.as_ref().unwrap_or(&sty.declarations),
                context.arena,
            ),
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
        // Empty block: route through the centralized `'bump`-erasure helper
        // instead of fabricating
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

        // A failed merge settles any pending declaration merge on the previous
        // last rule (and an unattempted one means it was never pending), so
        // every rule already in the list is fully minified here, which the
        // duplicate check below relies on.
        debug_assert!(!merge_state.pending_minify);
        rules.push(core::mem::replace(rule, CssRule::Ignored));
        merge_state.last_compat = sty_compat;

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

    // Appending anything below ends the current merge run, so settle any
    // pending declaration merge on the last rule first.
    if !logical.is_empty()
        || !supps.is_empty()
        || incompatible_rules.len() > 0
        || nested_rule.is_some()
    {
        flush_pending_style_merge(rules, merge_state, context);
        merge_state.last_compat = None;
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

// ─── StyleRuleKey ──────────────────────────────────────────────────────────
/// A key to a `StyleRule` meant for use in a hash map for quickly detecting
/// duplicates. It stores an index into the live `rules` Vec plus a
/// pre-computed hash for fast lookups.
///
/// NOTE: storing a `*const Vec<CssRule<R>>` in the key and dereferencing it
/// during equality would be unsound under Stacked/Tree Borrows — keys persist
/// in the dedup map across iterations of `minify_style_arm`, and between
/// iterations the same `Vec` is written through fresh `&mut` reborrows
/// (`rules.push`, `rules[i] = Ignored`), invalidating any previously-derived
/// `*const Vec` provenance. Instead we keep only `(index, hash)` here and do
/// the equality check in `StyleRuleKeyMap::remove_duplicate`, which receives
/// the live `&[CssRule<R>]` slice explicitly at the call site.
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

/// Dedup table for [`StyleRuleKey`]s.
///
/// Buckets keyed by the pre-computed `StyleRule::hash_key()` hold indices into
/// the caller's `rules` Vec; equality (`StyleRule::is_duplicate`) is evaluated
/// against an explicitly-passed `&[CssRule<R>]` so we never smuggle a stale
/// raw pointer across `&mut rules` writes (see the note on `StyleRuleKey`).
#[derive(Default)]
pub(crate) struct StyleRuleKeyMap {
    buckets: bun_collections::HashMap<u64, Vec<usize>>,
}

impl StyleRuleKeyMap {
    /// Find and remove an earlier index whose rule `is_duplicate` of
    /// `rules[key.index]`.
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
            // `other_idx != key.index`: the merge-with-previous cascade pops
            // rules without purging their indices from the buckets, so a
            // stale entry can alias the slot the checked rule was just pushed
            // into, and a rule trivially `is_duplicate` of itself. Erasing it
            // silently dropped the rule. (A live entry can never equal
            // `key.index`: the key is only inserted after this check.)
            // Bounds-check + Style tag-check + `is_duplicate`.
            other_idx != key.index
                && match rules.get(other_idx) {
                    Some(CssRule::Style(other_rule)) => rule.is_duplicate(other_rule),
                    _ => false,
                }
        })?;
        Some(bucket.swap_remove(pos))
    }

    /// Record the rule's index under its style-rule key for later dedup lookups.
    pub(crate) fn insert(&mut self, key: StyleRuleKey) {
        self.buckets.entry(key.hash).or_default().push(key.index);
    }

    pub(crate) fn clear(&mut self) {
        self.buckets.clear();
    }
}

// ─── merge_style_rules ─────────────────────────────────────────────────────

/// Cross-iteration state for the style-rule merge fast path in
/// [`CssRuleList::minify`].
///
/// `pending_minify` marks the last rule in the output list as a style rule
/// whose declarations were concatenated by one or more declaration merges but
/// not yet re-run through the property handlers. Re-minifying after every
/// single merge made a run of n same-selector rules re-feed the accumulated
/// declaration list through the handlers n times; handlers that emit one
/// output declaration per input declaration (custom properties, color-scheme,
/// prefixed background images, ...) keep that list O(n) long, so the total
/// work was O(n^2), and worse for handlers whose re-processing re-expands
/// their own output. Deferring to one re-minify per merge run keeps it O(n).
/// The flag must be cleared (via [`flush_pending_style_merge`]) before
/// anything reads the merged declarations or appends another rule.
///
/// `last_compat` caches `StyleRule::is_compatible` for the current last rule.
/// Selector merges grow the last rule's selector list by one selector per
/// merged rule, and re-walking every accumulated selector on each merge was
/// the same O(n^2) shape on the selector side. The cache is invalidated
/// whenever the last rule changes and updated incrementally on selector
/// merges (the merged result is compatible iff both inputs were).
#[derive(Default)]
pub(crate) struct StyleRuleMergeState {
    pending_minify: bool,
    last_compat: Option<bool>,
}

/// Re-run the declaration minifier on the last rule if it has pending merged
/// declarations, then attempt the merge-with-previous cascade that a
/// declaration merge enables (the re-minified declarations may now equal the
/// previous rule's, allowing a selector merge, and so on).
pub(crate) fn flush_pending_style_merge<R>(
    rules: &mut Vec<CssRule<R>>,
    state: &mut StyleRuleMergeState,
    context: &mut MinifyContext<'_, '_>,
) {
    while state.pending_minify {
        state.pending_minify = false;
        let Some(CssRule::Style(last)) = rules.last_mut() else {
            debug_assert!(false, "pending declaration merge without a style rule last");
            return;
        };
        // The re-minify can re-stage handler-context rules: `color-scheme`
        // re-emits itself and pushes its dark-mode fallback vars on every
        // pass. `minify_style_arm` therefore settles a pending merge before
        // collecting extras whenever the handler context has staged entries,
        // so re-staged entries land in the same iteration's extras exactly as
        // the per-merge re-minify produced. At every other flush point the
        // handler context has already been drained and the merged block
        // cannot contain a staging declaration (its own iteration's extras
        // would have ended the merge run right after it).
        last.declarations.minify(
            dc::decl_handler_static(&mut *context.handler),
            dc::decl_handler_static(&mut *context.important_handler),
            &mut context.handler_context,
        );
        cascade_merge_with_previous(rules, state, context);
    }
}

/// Try to merge the last style rule into the one before it, repeatedly, while
/// merges keep succeeding. A declaration merge leaves `state.pending_minify`
/// set, in which case the caller ([`flush_pending_style_merge`]) re-minifies
/// before cascading further.
fn cascade_merge_with_previous<R>(
    rules: &mut Vec<CssRule<R>>,
    state: &mut StyleRuleMergeState,
    context: &mut MinifyContext<'_, '_>,
) {
    // The last rule was settled before cascading, so `merge_style_rules`'s
    // pending flush (which targets its second argument) can't fire here.
    debug_assert!(!state.pending_minify);
    while rules.len() >= 2 {
        let len = rules.len();
        let (a, b) = rules.split_at_mut(len - 1);
        if let (CssRule::Style(prev), CssRule::Style(last)) = (&mut a[len - 2], &mut b[0]) {
            let mut prev_compat: Option<bool> = None;
            if merge_style_rules(
                last,
                prev,
                context,
                &mut state.pending_minify,
                &mut state.last_compat,
                &mut prev_compat,
            ) {
                rules.pop();
                // `prev` is the last rule now.
                state.last_compat = prev_compat;
                if state.pending_minify {
                    return;
                }
                continue;
            }
        }
        break;
    }
}

/// Compute (or reuse) `rule.is_compatible(targets)` through the merge-state
/// cache.
fn cached_is_compatible<R>(
    rule: &style::StyleRule<R>,
    cache: &mut Option<bool>,
    targets: &css::targets::Targets,
) -> bool {
    *cache.get_or_insert_with(|| rule.is_compatible(targets))
}

/// Merge `sty` into `last_style_rule` if their selectors/declarations allow.
/// Returns `true` if merged (caller should drop `sty`).
///
/// A declaration merge only concatenates the declaration lists and sets
/// `pending_minify`; the re-minify is deferred to the end of the merge run
/// (see [`StyleRuleMergeState`]). `pending_minify` may only be set on entry
/// when `last_style_rule` is the rule it tracks (the forward merge in
/// `minify_style_arm`); the cascade always settles it first.
/// `sty_compat` / `last_compat` cache `is_compatible` for the respective
/// argument.
pub(crate) fn merge_style_rules<R>(
    sty: &mut style::StyleRule<R>,
    last_style_rule: &mut style::StyleRule<R>,
    context: &mut MinifyContext<'_, '_>,
    pending_minify: &mut bool,
    sty_compat: &mut Option<bool>,
    last_compat: &mut Option<bool>,
) -> bool {
    use css::VendorPrefix;
    // Merge declarations if the selectors are equivalent, and both are compatible with all targets.
    // Does not apply if css modules are enabled.
    if sty.selectors.eql(&last_style_rule.selectors)
        && cached_is_compatible(sty, sty_compat, context.targets)
        && cached_is_compatible(last_style_rule, last_compat, context.targets)
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
        *pending_minify = true;
        return true;
    }

    // The declaration comparison below must see the canonical (minified)
    // form, so settle any pending merged declarations first.
    if *pending_minify {
        *pending_minify = false;
        last_style_rule.declarations.minify(
            dc::decl_handler_static(&mut *context.handler),
            dc::decl_handler_static(&mut *context.important_handler),
            &mut context.handler_context,
        );
    }

    if sty.declarations.eql(&last_style_rule.declarations)
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
        if cached_is_compatible(sty, sty_compat, context.targets)
            && cached_is_compatible(last_style_rule, last_compat, context.targets)
        {
            let moved = core::mem::take(&mut sty.selectors.v);
            // `reserve` (not `ensure_total_capacity`) so capacity grows
            // super-linearly across repeated merges, keeping the N-way merge
            // amortized O(N).
            last_style_rule.selectors.v.reserve(moved.len());
            for sel in moved {
                last_style_rule.selectors.v.append_assume_capacity(sel);
            }
            // Both sides were just proven compatible, so the combined selector
            // list is too.
            *last_compat = Some(true);
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

// Re-export the crate-root struct so `css_rules::Location` and
// `crate::Location` are interchangeable (one nominal type).
pub use crate::Location;

/// Printer's nesting cursor — linked list of parent selector lists used to
/// resolve `&` during serialization.
pub struct StyleContext<'a> {
    pub selectors: &'a crate::selectors::SelectorList,
    pub parent: Option<&'a StyleContext<'a>>,
}

/// Upper bound on the number of selectors that compiling nested rules away for
/// the configured targets may expand a stylesheet into.
///
/// When the targets don't support CSS nesting (or a rule's selectors need to be
/// split for compatibility), every nesting level multiplies the parent
/// selector list into its nested rules. That expansion is exponential in the
/// nesting depth, so a few hundred bytes of adversarial input (e.g. 20+ levels
/// of two-selector rules) would otherwise balloon into gigabytes of cloned
/// rules and output. Real-world stylesheets stay far below this limit — 65,536
/// expanded selectors already corresponds to megabytes of output — so exceeding
/// it is reported as a `selector_expansion_limit_exceeded` minify error
/// instead.
pub const MAX_SELECTOR_EXPANSION: u32 = 65_536;

/// Per-stylesheet minification state threaded through `CssRuleList::minify`
/// and every leaf rule's `minify`.
///
/// All sub-allocations during minify go
/// through it so the whole transformed tree is bulk-freed with the arena.
// Split lifetimes — `'bump` is the parser arena (long), `'a` is the
// per-minify borrow scope (short). `&'a mut DeclarationHandler<'a>` would force
// the handler borrow to outlive the arena (invariance via `bumpalo::Vec`),
// making `Stylesheet::minify`'s stack-local handlers unusable.
pub struct MinifyContext<'a, 'bump> {
    /// Arena that owns the AST being minified (same arena it was parsed into).
    pub arena: &'bump bun_alloc::Arena,
    pub targets: &'a css::targets::Targets,
    pub handler: &'a mut css::DeclarationHandler<'bump>,
    pub important_handler: &'a mut css::DeclarationHandler<'bump>,
    pub handler_context: css::PropertyHandlerContext<'bump>,
    /// Class/id names known to be unused (tree-shaking input).
    // `selector::is_unused` currently borrows `&ArrayHashMap<&[u8], ()>`; the
    // owning `MinifyOptions` stores `Box<[u8]>` keys — reconcile to a
    // single key type with `Borrow<[u8]>` lookup.
    pub unused_symbols: &'a bun_collections::ArrayHashMap<Box<[u8]>, ()>,
    /// Pre-scanned `@custom-media` definitions, if the feature is enabled.
    pub custom_media:
        Option<bun_collections::ArrayHashMap<Box<[u8]>, custom_media::CustomMediaRule>>,
    pub extra: &'a css::StylesheetExtra,
    pub css_modules: bool,
    /// First minification error encountered (surfaced out-of-band).
    pub err: Option<css::error::MinifyError>,
    /// How many copies of the current rule's selectors compiling the enclosing
    /// nesting for the targets will produce — the product of the enclosing
    /// style rules' selector-list lengths. `1` at the top level.
    pub selector_expansion_multiplier: u32,
    /// Running total of selectors that compiling nested rules for the targets
    /// will expand to, checked against [`MAX_SELECTOR_EXPANSION`].
    pub selector_expansion_total: u32,
}
