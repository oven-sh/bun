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
// An earlier iteration threaded a `'bump` arena lifetime through every
// rule. That cascades into
// every leaf module signature; while those leaves are gated, `CssRule<R>` is
// kept lifetime-free here (the gated bodies re-introduce `'bump` when they
// un-gate alongside `bumpalo::collections::Vec` storage).

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
                    // `TailwindAtRule` is ever un-gated, thread a `ToCss`-style bound
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
    // PERF: re-thread to `bun_alloc::ArenaVec<'bump, CssRule<'bump, R>>`
    // when leaf rules un-gate.
    pub v: Vec<CssRule<R>>,
}

// `CssRuleList<R>` is auto-`Send`/`Sync` via `Vec<CssRule<R>>` and the
// `CssRule<R>` impls above — no `unsafe impl` needed.

impl<R> Default for CssRuleList<R> {
    fn default() -> Self {
        Self { v: Vec::new() }
    }
}

// ─── leaf-rule to_css shims ────────────────────────────────────────────────
// All leaf modules now own a real, un-gated `to_css` body; `CssRule::to_css`
// dispatches straight through. (Shim macro deleted — last entry was
// `StyleRule`, dropped once DeclarationBlock::to_css + selector serialize
// landed.)

// ─── leaf-rule deep_clone ──────────────────────────────────────────────────
// Every leaf module now owns a real inherent `deep_clone` body — the field-
// wise / variant-wise port of `css.implementDeepClone`. `CssRule::deep_clone`
// (below) dispatches via method-syntax so it picks up the inherent impl.
//
// Most leaf rules can't use `#[derive(DeepClone)]` directly yet
// because two field types still lack an arena-aware `deep_clone(&self,
// &Arena) -> Self`: `SelectorList` (selectors/parser.rs uses no-arg
// `deep_clone()`) and `Property` (properties_generated.rs — per-variant body
// gated on leaf_value_traits). `MediaList` / `QueryFeature` /
// `DeclarationBlock` now route to their real arena-aware impls. The leaf
// bodies hand-roll the field walk and route the remaining blocked fields
// through the `dc::*` passthroughs below. Once an upstream type grows its own
// `deep_clone(&self, &Arena)`, swap the `dc::foo(&x, bump)` call for
// `x.deep_clone(bump)` and delete the helper.
pub(super) mod dc {
    use bun_alloc::Arena;

    /// `DeclarationBlock::deep_clone` — real port body inlined here (the
    /// canonical impl in declaration.rs is gated on `Property: DeepClone`).
    /// Field-walk over both `DeclarationList`s, routing each `Property`
    /// through `dc::property` so the only remaining bottleneck is the
    /// per-variant `Property::deep_clone` body.
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
// Several leaf-rule `to_css` bodies bottom out on helpers whose canonical
// homes are still ``-gated outside `rules/` (DeclarationBlock::
// to_css_block, VendorPrefix::toCss, CustomIdent/DashedIdent ::toCss). The
// bodies are tiny and have no further blockers, so they're inlined here so the
// 12 leaf rules can serialize for real. Once the upstream gates drop, callers
// switch back and these are deleted.

/// `DeclarationBlock` block serialization. The real impl is gated in
/// `declaration.rs`; `Property::to_css` is un-gated so the body is
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

/// Port of `CustomIdentFns.toCss` → `Printer.writeIdent` with CSS-module
/// custom-ident scoping. Both `CustomIdent::to_css` and `Printer::write_ident`
/// are gated on the css_modules `Pattern::write` borrowck reshape; this is the
/// non-css-module tail (`serialize_identifier`) that both share.
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

/// Port of `DashedIdentFns.toCss` → `Printer.writeDashedIdent`. The real
/// printer method is gated on a borrowck reshape of the css-module pattern
/// closure; the non-css-module path (the only one any current rule reaches)
/// is `--` + `serialize_name(rest)`.
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

/// Shim: `MediaRule::minify` is gated in `media.rs` until that file's full
/// `to_css` body un-gates. Recurse into the nested list and report whether the
/// rule should be dropped. NOTE: `never_matches()` is a *drop condition*, not
/// merely an optimization — omitting it diverges output (e.g. `@media not all
/// { a{color:red} }` must be removed). `MediaList::never_matches` is un-gated,
/// so call it here.
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
        // blocked_on (style arm only): StyleRule::{minify,is_compatible,
        // update_prefix,hash_key,is_duplicate}, selector::{is_compatible,
        // is_equivalent,Selector::from_component}, SelectorList::deep_clone,
        // DeclarationBlock::deep_clone — all `` in their leaves.

        let mut style_rules = StyleRuleKeyMap::default();
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
                        // The full `.style` arm (selector compat partitioning,
                        // merge-with-previous, logical/@supports expansion,
                        // dedup via StyleRuleKey, nested-rule split) bottoms
                        // out on the gated StyleRule behavior surface. Until
                        // that un-gates, fall through and keep the rule as-is.

                        {
                            minify_style_arm(
                                rule,
                                &mut rules,
                                &mut style_rules,
                                context,
                                parent_is_unused,
                            )?;
                            break 'arm;
                        }
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
    if incompatible.len() > 0 {
        // Each split-off selector clones this rule's declarations and entire
        // nested-rule subtree (loop below). The subtree already contains the
        // clones split off while minifying deeper levels, so under nesting the
        // cloned payload compounds exponentially with depth.
        // `charge_selector_expansion` bounds how many rules this produces but
        // not their size; bound the cumulative cloned payload too, so huge
        // token lists or declaration blocks can't multiply into gigabytes
        // while staying under the selector-count cap.
        let per_clone = clone_weight::RULE
            .saturating_add(clone_weight::decl_block(&sty.declarations))
            .saturating_add(clone_weight::rule_list(&sty.rules));
        context.split_clone_weight_total = context
            .split_clone_weight_total
            .saturating_add(per_clone.saturating_mul(incompatible.len() as u64));
        if context.split_clone_weight_total > MAX_SELECTOR_SPLIT_CLONE_WEIGHT {
            context.err = Some(crate::error::MinifyError {
                kind: crate::error::MinifyErrorKind::selector_split_clone_limit_exceeded,
                loc: sty.loc,
            });
            return Err(MinifyErr::minify_err);
        }
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

/// Weight estimate for the rule clones made by `minify_style_arm`'s
/// incompatible-selector split, in roughly byte-sized units, charged against
/// [`MAX_SELECTOR_SPLIT_CLONE_WEIGHT`].
///
/// The walk counts the structures whose count or size scales with user input:
/// rules, declarations, selector components (recursing into selector-list
/// arguments), and raw token lists (token count plus borrowed text length —
/// the text is borrowed by the clone but re-emitted per clone when printed).
/// Every variant that stores its text inline is charged that text: token
/// payloads (including dimension units and dashed idents), var()/env()/
/// function and pseudo-class names, custom-property names, and selector
/// text (classes, ids, element and attribute names, attribute values).
/// Parsed leaf values and `url()` (whose text lives in the stylesheet's
/// import records, not reachable here) are charged a flat constant: their
/// per-rule size is bounded by the input, and the number of clones is bounded
/// by [`MAX_SELECTOR_EXPANSION`]. The walk runs once per split rule, so its
/// own cost stays proportional to the weight it charges.
mod clone_weight {
    use super::{CssRule, CssRuleList};
    use crate as css;
    use css::properties::Property;
    use css::properties::custom::{TokenList, TokenOrValue};
    use css::selectors::{Component, PseudoClass, PseudoElement, Selector, SelectorList};

    /// Flat weight of one rule (struct + bookkeeping).
    pub(super) const RULE: u64 = 64;
    /// Flat weight of one declaration.
    const DECL: u64 = 64;
    const COMPONENT: u64 = 16;
    const TOKEN: u64 = 16;

    pub(super) fn rule_list<R>(rules: &CssRuleList<R>) -> u64 {
        rules.v.iter().map(rule).fold(0u64, u64::saturating_add)
    }

    fn rule<R>(rule: &CssRule<R>) -> u64 {
        let nested = match rule {
            CssRule::Style(sty) => selector_list(&sty.selectors)
                .saturating_add(decl_block(&sty.declarations))
                .saturating_add(rule_list(&sty.rules)),
            CssRule::Media(r) => rule_list(&r.rules),
            CssRule::Supports(r) => rule_list(&r.rules),
            CssRule::Container(r) => rule_list(&r.rules),
            CssRule::LayerBlock(r) => rule_list(&r.rules),
            CssRule::MozDocument(r) => rule_list(&r.rules),
            CssRule::Scope(r) => rule_list(&r.rules),
            CssRule::StartingStyle(r) => rule_list(&r.rules),
            CssRule::Nesting(r) => selector_list(&r.style.selectors)
                .saturating_add(decl_block(&r.style.declarations))
                .saturating_add(rule_list(&r.style.rules)),
            CssRule::Keyframes(r) => r
                .keyframes
                .iter()
                .map(|k| decl_block(&k.declarations))
                .fold(0u64, u64::saturating_add),
            CssRule::Unknown(r) => {
                token_list(&r.prelude).saturating_add(r.block.as_ref().map_or(0, token_list))
            }
            // Remaining rules can't contain nested style rules; their payload
            // is bounded per rule by the input.
            _ => 0,
        };
        RULE.saturating_add(nested)
    }

    pub(super) fn decl_block(decls: &css::DeclarationBlock) -> u64 {
        decls
            .declarations
            .iter()
            .chain(decls.important_declarations.iter())
            .map(property)
            .fold(0u64, u64::saturating_add)
    }

    fn property(property: &Property) -> u64 {
        use css::properties::custom::CustomPropertyName;
        DECL.saturating_add(match property {
            Property::Custom(c) => {
                let name_len = match &c.name {
                    CustomPropertyName::Custom(ident) => ident.v().len(),
                    CustomPropertyName::Unknown(ident) => ident.v().len(),
                };
                (name_len as u64).saturating_add(token_list(&c.value))
            }
            Property::Unparsed(u) => token_list(&u.value),
            _ => 0,
        })
    }

    pub(super) fn selector_list(list: &SelectorList) -> u64 {
        selector_slice(list.v.slice())
    }

    fn selector_slice(selectors: &[Selector]) -> u64 {
        selectors
            .iter()
            .map(|sel| {
                sel.components
                    .iter()
                    .map(component)
                    .fold(0u64, u64::saturating_add)
            })
            .fold(0u64, u64::saturating_add)
    }

    fn component(component: &Component) -> u64 {
        use css::selectors::parser::attrs::ParsedAttrSelectorOperation;
        COMPONENT.saturating_add(match component {
            Component::Negation(list)
            | Component::Where(list)
            | Component::Is(list)
            | Component::Has(list)
            | Component::Any {
                selectors: list, ..
            } => selector_slice(list),
            Component::NthOf(data) => selector_slice(&data.selectors),
            Component::Slotted(sel) => selector_slice(core::slice::from_ref(sel)),
            Component::Host(Some(sel)) => selector_slice(core::slice::from_ref(sel)),
            Component::NonTsPseudoClass(pseudo) => pseudo_class(pseudo),
            Component::PseudoElement(pseudo) => pseudo_element(pseudo),
            // CSS-modules locals (`IdentOrRef::is_ref`) print a symbol-table
            // name instead of inline text; they are charged the flat constant.
            Component::Id(ident) | Component::Class(ident) => {
                ident.as_ident().map_or(0, |i| i.v().len() as u64)
            }
            Component::LocalName(name) => name.name.v().len() as u64,
            Component::Namespace { prefix, url } => {
                (prefix.v().len() as u64).saturating_add(url.len() as u64)
            }
            Component::DefaultNamespace(url) => url.len() as u64,
            Component::Part(idents) => idents
                .iter()
                .map(|i| i.v().len() as u64)
                .fold(0u64, u64::saturating_add),
            Component::AttributeInNoNamespaceExists { local_name, .. } => {
                local_name.v().len() as u64
            }
            Component::AttributeInNoNamespace {
                local_name, value, ..
            } => (local_name.v().len() as u64).saturating_add(value.len() as u64),
            Component::AttributeOther(attr) => {
                (attr.local_name.v().len() as u64).saturating_add(match &attr.operation {
                    ParsedAttrSelectorOperation::WithValue { expected_value, .. } => {
                        expected_value.len() as u64
                    }
                    ParsedAttrSelectorOperation::Exists => 0,
                })
            }
            _ => 0,
        })
    }

    fn pseudo_class(pseudo: &PseudoClass) -> u64 {
        match pseudo {
            PseudoClass::CustomFunction { name, arguments } => {
                (name.len() as u64).saturating_add(token_list(arguments))
            }
            PseudoClass::Custom { name } => name.len() as u64,
            PseudoClass::Lang { languages } => languages
                .iter()
                .map(|l| l.len() as u64)
                .fold(0u64, u64::saturating_add),
            _ => 0,
        }
    }

    fn pseudo_element(pseudo: &PseudoElement) -> u64 {
        match pseudo {
            PseudoElement::CustomFunction { name, arguments } => {
                (name.len() as u64).saturating_add(token_list(arguments))
            }
            PseudoElement::Custom { name } => name.len() as u64,
            _ => 0,
        }
    }

    fn token_list(tokens: &TokenList) -> u64 {
        tokens
            .v
            .iter()
            .map(|t| {
                TOKEN.saturating_add(match t {
                    TokenOrValue::Token(token) => token_text_len(token),
                    TokenOrValue::Var(var) => (var.name.ident.v().len() as u64)
                        .saturating_add(var.fallback.as_ref().map_or(0, token_list)),
                    TokenOrValue::Env(env) => env_name_len(&env.name)
                        .saturating_add(env.fallback.as_ref().map_or(0, token_list)),
                    TokenOrValue::Function(f) => {
                        (f.name.v().len() as u64).saturating_add(token_list(&f.arguments))
                    }
                    TokenOrValue::UnresolvedColor(color) => unresolved_color(color),
                    TokenOrValue::DashedIdent(ident) => ident.v().len() as u64,
                    TokenOrValue::AnimationName(name) => animation_name_len(name),
                    // `Url` stores only an import-record index; see the module
                    // doc. Remaining variants are fixed-size parsed values.
                    _ => 0,
                })
            })
            .fold(0u64, u64::saturating_add)
    }

    fn env_name_len(name: &css::properties::custom::EnvironmentVariableName) -> u64 {
        use css::properties::custom::EnvironmentVariableName;
        match name {
            EnvironmentVariableName::Ua(_) => 0,
            EnvironmentVariableName::Custom(reference) => reference.ident.v().len() as u64,
            EnvironmentVariableName::Unknown(ident) => ident.v().len() as u64,
        }
    }

    fn animation_name_len(name: &css::properties::animation::AnimationName) -> u64 {
        use css::properties::animation::AnimationName;
        match name {
            AnimationName::None => 0,
            AnimationName::Ident(ident) => ident.v().len() as u64,
            AnimationName::String(s) => s.len() as u64,
        }
    }

    fn unresolved_color(color: &css::properties::custom::UnresolvedColor) -> u64 {
        use css::properties::custom::UnresolvedColor;
        match color {
            UnresolvedColor::RGB { alpha, .. } | UnresolvedColor::HSL { alpha, .. } => {
                token_list(alpha)
            }
            UnresolvedColor::LightDark { light, dark } => {
                token_list(light).saturating_add(token_list(dark))
            }
        }
    }

    fn token_text_len(token: &css::Token) -> u64 {
        use css::Token;
        match token {
            Token::Ident(v)
            | Token::Function(v)
            | Token::AtKeyword(v)
            | Token::UnrestrictedHash(v)
            | Token::IdHash(v)
            | Token::QuotedString(v)
            | Token::BadString(v)
            | Token::UnquotedUrl(v)
            | Token::BadUrl(v)
            | Token::Whitespace(v)
            | Token::Comment(v) => v.len() as u64,
            // The unit of an unknown dimension is arbitrary-length ident text
            // (e.g. `1aaaa...`), kept as a raw token.
            Token::Dimension(d) => d.unit.len() as u64,
            _ => 0,
        }
    }
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
            // Bounds-check + Style tag-check + `is_duplicate`.
            match rules.get(other_idx) {
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
            // super-linearly across repeated merges, keeping the N-way merge
            // amortized O(N).
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

/// Upper bound on the cumulative weight (roughly bytes of AST payload) of
/// style-rule clones produced by splitting selector lists that are
/// incompatible with the configured targets.
///
/// `minify_style_arm` clones a rule's declarations and its entire nested-rule
/// subtree once per split-off selector. Under CSS nesting the subtree at each
/// level already contains the clones split off at deeper levels, so the cloned
/// payload compounds exponentially with nesting depth. [`MAX_SELECTOR_EXPANSION`]
/// bounds how many rules the split can produce but not their size: each clone
/// can carry arbitrarily large token lists or declaration blocks, so a few
/// hundred kilobytes of adversarial input could otherwise clone (and later
/// print) gigabytes while staying under the selector-count cap. Real-world
/// stylesheets duplicate at most a few kilobytes here.
pub const MAX_SELECTOR_SPLIT_CLONE_WEIGHT: u64 = 64 << 20;

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
    // owning `MinifyOptions` stores `Box<[u8]>` keys — reconcile when
    // `style.rs::minify` un-gates (single key type, `Borrow<[u8]>` lookup).
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
    /// Running total of the weight of rule clones made when splitting
    /// target-incompatible selector lists, checked against
    /// [`MAX_SELECTOR_SPLIT_CLONE_WEIGHT`].
    pub split_clone_weight_total: u64,
}
