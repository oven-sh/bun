use crate as css;

use css::PrintErr;
use css::Printer;
use css::error::MinifyErr;

// PERF: heap-backed shim.
// TODO(refactor): replace this with `crate::generics::ArrayList<'bump, T>`
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
pub mod unknown;
pub mod viewport;

// ─── CssRule variant table ────────────────────────────────────────────────
// Single source of truth for the 21 typed rule payloads. Adding a new
// at-rule = one line here; the enum variant + `to_css` arm + `deep_clone`
// arm are generated. `Unknown`/`Custom`/`Ignored` stay a fixed tail because
// their `to_css` arms are special-cased (see the note on `Custom`).
// `, ctx` marks the rules whose `to_css` takes the enclosing `StyleContext`.
macro_rules! css_rule_variants {
    ( |$ctx:ident| $( $(#[$doc:meta])* $Variant:ident($Payload:ty $(, $arg:ident)?) ),+ $(,)? ) => {
        /// A single CSS rule (at-rule or style rule).
        pub enum CssRule<'bump, R> {
            $( $(#[$doc])* $Variant($Payload), )+
            /// A placeholder for a rule that was removed.
            Ignored,
            /// An unknown at-rule.
            Unknown(unknown::UnknownAtRule<'bump>),
            /// A custom at-rule.
            Custom(R),
        }

        impl<'bump, R> CssRule<'bump, R> {
            pub fn to_css(
                &self,
                dest: &mut Printer,
                $ctx: Option<&StyleContext<'_, 'bump>>,
            ) -> Result<(), PrintErr> {
                match self {
                    $( CssRule::$Variant(x) => x.to_css(dest $(, $arg)?), )+
                    CssRule::Unknown(x) => {
                        // `.a { @apply x }`: outside of its style rule it would apply to nothing.
                        if nesting::enclosing_selectors_to_css(dest, $ctx)? {
                            return dest.block(|d| {
                                d.newline()?;
                                x.to_css(d)
                            });
                        }
                        x.to_css(dest)
                    }
                    // The only concrete `R` is `DefaultAtRule`, so erroring here
                    // is correct for every `R` that is actually instantiated. If
                    // another `R` is ever added, thread a `ToCss`-style bound
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
            pub fn deep_clone(&self, bump: &'bump bun_alloc::Arena) -> Self
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
    |ctx|
    /// A `@media` rule.
    Media(media::MediaRule<'bump, R>, ctx),
    /// An `@import` rule.
    Import(import::ImportRule<'bump>),
    /// A style rule.
    Style(style::StyleRule<'bump, R>, ctx),
    /// A `@keyframes` rule.
    Keyframes(keyframes::KeyframesRule<'bump>),
    /// A `@font-face` rule.
    FontFace(font_face::FontFaceRule<'bump>),
    /// A `@font-palette-values` rule.
    FontPaletteValues(font_palette_values::FontPaletteValuesRule<'bump>),
    /// A `@page` rule.
    Page(page::PageRule<'bump>),
    /// A `@supports` rule.
    Supports(supports::SupportsRule<'bump, R>, ctx),
    /// A `@counter-style` rule.
    CounterStyle(counter_style::CounterStyleRule<'bump>),
    /// A `@namespace` rule.
    Namespace(namespace::NamespaceRule<'bump>),
    /// A `@-moz-document` rule.
    MozDocument(document::MozDocumentRule<'bump, R>, ctx),
    /// A `@nest` rule.
    Nesting(nesting::NestingRule<'bump, R>, ctx),
    /// A nested declarations rule.
    NestedDeclarations(nesting::NestedDeclarationsRule<'bump>, ctx),
    /// A `@viewport` rule.
    Viewport(viewport::ViewportRule<'bump>),
    /// A `@custom-media` rule.
    CustomMedia(custom_media::CustomMediaRule<'bump>),
    /// A `@layer` statement rule.
    LayerStatement(layer::LayerStatementRule<'bump>),
    /// A `@layer` block rule.
    LayerBlock(layer::LayerBlockRule<'bump, R>, ctx),
    /// A `@property` rule.
    Property(property::PropertyRule<'bump>),
    /// A `@container` rule.
    Container(container::ContainerRule<'bump, R>, ctx),
    /// A `@scope` rule.
    Scope(scope::ScopeRule<'bump, R>, ctx),
    /// A `@starting-style` rule.
    StartingStyle(starting_style::StartingStyleRule<'bump, R>, ctx),
}

// The bundler's worker threads share parsed style sheets.
const _: fn() = || {
    fn assert<T: Send + Sync>() {}
    assert::<CssRule<'static, css::DefaultAtRule>>();
};

/// Ordered list of CSS rules, generic over the custom at-rule type `R`.
pub struct CssRuleList<'bump, R> {
    // PERF: re-thread to `bun_alloc::ArenaVec<'bump, CssRule<'bump, R>>`.
    pub v: Vec<CssRule<'bump, R>>,
}

impl<R> Default for CssRuleList<'_, R> {
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
mod dc {
    use bun_alloc::Arena;

    /// `DeclarationBlock::deep_clone` — field-walk over both
    /// `DeclarationList`s, routing each `Property` through `dc::property`.
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

    /// `MediaList::deep_clone` — routes to the real arena-aware impl in
    /// media_query.rs (element-wise walk of `media_queries`).
    #[inline]
    pub(crate) fn media_list<'bump>(
        this: &crate::media_query::MediaList<'bump>,
        bump: &'bump Arena,
    ) -> crate::media_query::MediaList<'bump> {
        this.deep_clone(bump)
    }

    /// `SelectorList::deep_clone` re-derives the source `ArenaPtr` instead of
    /// taking `bump`; intra-arena only (footgun if a cross-arena clone is added).
    #[inline]
    pub(crate) fn selector_list<'bump>(
        this: &crate::selectors::SelectorList<'bump>,
        _bump: &Arena,
    ) -> crate::selectors::SelectorList<'bump> {
        this.deep_clone()
    }

    /// `QueryFeature<F>::deep_clone` — routes to the real arena-aware impl in
    /// media_query.rs (variant-wise walk recursing into `MediaFeatureValue`).
    #[inline]
    pub(crate) fn query_feature<'bump, F>(
        this: &crate::media_query::QueryFeature<'bump, F>,
        bump: &'bump Arena,
    ) -> crate::media_query::QueryFeature<'bump, F>
    where
        F: crate::media_query::FeatureIdTrait,
    {
        this.deep_clone(bump)
    }

    /// `Property::deep_clone` — routes to the real inherent
    /// `Property::deep_clone` in properties_generated.rs.
    #[inline]
    pub(crate) fn property<'bump>(
        this: &crate::properties::Property<'bump>,
        bump: &'bump Arena,
    ) -> crate::properties::Property<'bump> {
        this.deep_clone(bump)
    }
}

// `Location` is plain `Copy` data; the derive expands to field-wise
// `u32::deep_clone` (identity). Doubles as the in-tree smoke test that the
// `#[derive(DeepClone)]` proc-macro round-trips through a real CSS type.

// ─── shared serialization helpers for leaf rules ──────────────────────────

/// `DeclarationBlock` block serialization.
fn decl_block_to_css(
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
fn vendor_prefix_to_css(prefix: css::VendorPrefix, dest: &mut Printer) -> Result<(), PrintErr> {
    use css::VendorPrefix as VP;
    match prefix.bits() {
        b if b == VP::WEBKIT.bits() => dest.write_str("-webkit-"),
        b if b == VP::MOZ.bits() => dest.write_str("-moz-"),
        b if b == VP::MS.bits() => dest.write_str("-ms-"),
        b if b == VP::O.bits() => dest.write_str("-o-"),
        _ => Ok(()),
    }
}

/// Port of `DashedIdentFns.toCss` → `Printer.writeDashedIdent`. The
/// non-css-module path (the only one any current rule reaches) is
/// `--` + `serialize_name(rest)`.
#[inline]
fn dashed_ident_to_css(
    ident: &css::css_values::ident::DashedIdent,
    dest: &mut Printer,
) -> Result<(), PrintErr> {
    let v = ident.v;
    dest.write_str("--")?;
    dest.serialize_name(&v[2..])
}

/// Recurse into the nested list and report whether the rule should be
/// dropped. NOTE: `never_matches()` is a *drop condition*, not merely an
/// optimization — omitting it diverges output (e.g. `@media not all
/// { a{color:red} }` must be removed).
impl<'bump, R> media::MediaRule<'bump, R> {
    pub(crate) fn minify(
        &mut self,
        context: &mut MinifyContext<'_, 'bump>,
        parent_is_unused: bool,
    ) -> Result<bool, MinifyErr>
    where
        R: css::generics::DeepClone<'bump>,
    {
        self.rules.minify(context, parent_is_unused)?;
        Ok(self.rules.v.is_empty() || self.query.never_matches())
    }
}

impl<R> CssRule<'_, R> {
    /// Whether this rule is skipped while `Printer::skip_prefixed_nested_rules`
    /// is set (a non-final vendor prefix pass of an ancestor style rule) and
    /// emitted only in the ancestor's final pass: a style rule with its own
    /// vendor prefixes overrides `Printer::vendor_prefix`, so its output is
    /// identical in every ancestor pass.
    fn is_deferred_to_final_prefix_pass(&self) -> bool {
        match self {
            CssRule::Style(style) => !style.vendor_prefix.is_empty(),
            CssRule::Nesting(nesting) => !nesting.style.vendor_prefix.is_empty(),
            _ => false,
        }
    }
}

// ─── CssRuleList::{to_css,minify,deep_clone} ──────────────────────────────

impl<'bump, R> CssRuleList<'bump, R> {
    pub fn to_css(
        &self,
        dest: &mut Printer,
        ctx: Option<&StyleContext<'_, 'bump>>,
    ) -> Result<(), PrintErr> {
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
            // After nested declarations: see `Printer::pending_semicolon`.
            if core::mem::take(&mut dest.pending_semicolon) {
                dest.write_char(b';')?;
            }
            rule.to_css(dest, ctx)?;
            last_without_block = matches!(
                rule,
                CssRule::Import(_) | CssRule::Namespace(_) | CssRule::LayerStatement(_)
            );
        }
        Ok(())
    }

    pub(crate) fn minify(
        &mut self,
        context: &mut MinifyContext<'_, 'bump>,
        parent_is_unused: bool,
    ) -> Result<(), MinifyErr>
    where
        R: css::generics::DeepClone<'bump>,
    {
        self.minify_nested(context, parent_is_unused, None)
    }

    /// `enclosing`: the handler context of the style rule that owns this list.
    pub(crate) fn minify_nested(
        &mut self,
        context: &mut MinifyContext<'_, 'bump>,
        parent_is_unused: bool,
        mut enclosing: Option<&mut css::PropertyHandlerContext<'_, 'bump>>,
    ) -> Result<(), MinifyErr>
    where
        R: css::generics::DeepClone<'bump>,
    {
        let mut style_rules = StyleRuleKeyMap::default();
        let mut merge_state = StyleRuleMergeState::default();
        // The `:dir()` rules of later nested declarations go before the nested rules.
        let mut dir_rules: Vec<CssRule<R>> = Vec::new();
        let mut dir_slot = 0;
        let mut rules: Vec<CssRule<R>> = Vec::new();

        let mut source = self.v.iter_mut().peekable();
        while let Some(rule) = source.next() {
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
                        // A run of rules with the same query is one rule, minified once.
                        while let Some(CssRule::Media(next)) = source.next_if(|next| {
                            matches!(next, CssRule::Media(next) if next.query.eql(&med.query))
                        }) {
                            med.rules.v.append(&mut next.rules.v);
                        }
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
                        // An empty named block still declares its layer's place in the order.
                        if lay.rules.v.is_empty() && lay.name.is_none() {
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
                    CssRule::NestedDeclarations(nested) => {
                        if parent_is_unused {
                            break 'arm;
                        }
                        // A later flush would find the rules staged below.
                        flush_pending_style_merge(
                            &mut rules,
                            &mut style_rules,
                            &mut merge_state,
                            context,
                        );
                        // Consecutive declarations are one rule, also across a dropped rule.
                        if let Some(CssRule::NestedDeclarations(last)) = rules.last_mut() {
                            core::mem::swap(last, nested);
                            nested.declarations.append(&mut last.declarations);
                            rules.pop();
                        }
                        while let Some(CssRule::NestedDeclarations(next)) =
                            source.next_if(|next| matches!(next, CssRule::NestedDeclarations(_)))
                        {
                            nested.declarations.append(&mut next.declarations);
                        }
                        let is_first = rules.is_empty();
                        let (dir, fallbacks) =
                            nested.minify::<R>(context, enclosing.as_deref_mut())?;
                        merge_state.last_compat = None;
                        style_rules.clear();
                        if !nested.declarations.is_empty() {
                            rules.push(core::mem::replace(rule, CssRule::Ignored));
                        }
                        if is_first {
                            rules.extend(dir);
                        } else {
                            dir_rules.extend(dir);
                        }
                        rules.extend(fallbacks);
                        if is_first {
                            dir_slot = rules.len();
                        }
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
                        // 1: its selector list is never split.
                        nst.style
                            .minify_nested_rules(context, parent_is_unused, 1)?;
                    }
                    CssRule::StartingStyle(rl) => {
                        // See `Container` above: recurse so nested style rules
                        // count against the selector-expansion cap.
                        rl.rules.minify(context, parent_is_unused)?;
                    }
                    CssRule::Unknown(unknown) => {
                        // Like nested declarations, it prints the enclosing selector list.
                        context.charge_selector_expansion(1, unknown.loc)?;
                    }
                    CssRule::FontPaletteValues(_) => {}
                    CssRule::Property(_) => {}
                    _ => {}
                }

                // Appending a non-style rule ends the current style-rule merge
                // run, so settle any pending declaration merge first.
                flush_pending_style_merge(&mut rules, &mut style_rules, &mut merge_state, context);
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
        flush_pending_style_merge(&mut rules, &mut style_rules, &mut merge_state, context);

        let dir_slot = dir_slot.min(rules.len());
        rules.splice(dir_slot..dir_slot, dir_rules);

        // The old Vec is dropped on assignment.
        self.v = rules;
        Ok(())
    }

    pub(crate) fn deep_clone(&self, bump: &'bump bun_alloc::Arena) -> Self
    where
        R: css::generics::DeepClone<'bump>,
    {
        Self {
            v: self.v.iter().map(|r| r.deep_clone(bump)).collect(),
        }
    }
}

fn minify_style_arm<'bump, R: css::generics::DeepClone<'bump>>(
    rule: &mut CssRule<'bump, R>,
    rules: &mut Vec<CssRule<'bump, R>>,
    style_rules: &mut StyleRuleKeyMap,
    merge_state: &mut StyleRuleMergeState,
    context: &mut MinifyContext<'_, 'bump>,
    parent_is_unused: bool,
) -> Result<(), MinifyErr> {
    use css::SmallList;
    use css::selector::{self, Selector, SelectorList};
    let CssRule::Style(sty) = rule else {
        unreachable!()
    };

    if parent_is_unused {
        return Ok(());
    }

    let split_rule_count = sty.split_rule_count(context.targets);
    if sty.minify(context, parent_is_unused, split_rule_count)? {
        return Ok(());
    }

    // If some of the selectors in this rule are not compatible with the targets,
    // we need to split them into multiple rules.
    let mut incompatible = SmallList::<Selector, 1>::default();
    if split_rule_count > 1 {
        for sel in core::mem::take(&mut sty.selectors.v) {
            if selector::is_compatible(core::slice::from_ref(&sel), context.targets) {
                sty.selectors.v.append(sel);
            } else {
                incompatible.append(sel);
            }
        }
    }

    sty.update_prefix(context);

    // The declaration merge below drains `sty.declarations`, but the rules
    // built for the partitioned-out incompatible selectors clone it after the
    // merge. Snapshot it first, or a merge would silently drop the
    // incompatible selectors' styling.
    let incompatible_decls: Option<css::DeclarationBlock> = if incompatible.len() > 0 {
        Some(dc::decl_block(&sty.declarations, context.arena))
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
            cascade_merge_with_previous(rules, style_rules, merge_state, context);
        }
        merged = true;
    }

    if !merged && had_pending {
        // The failed merge settled the previous run's pending declarations
        // (merge_style_rules re-minifies before its declaration comparison);
        // run the merge-with-previous cascade that settling enables, which the
        // per-merge re-minify used to drive at the end of that run.
        debug_assert!(!merge_state.pending_minify);
        cascade_merge_with_previous(rules, style_rules, merge_state, context);
        // A selector merge in the cascade can make the next pair's selectors
        // equal and start a new declaration merge, which the cascade returns
        // on. Settle it now: `sty` is pushed below, which would bury the
        // pending rule one slot down where no later flush can find it.
        flush_pending_style_merge(rules, style_rules, merge_state, context);
    }

    // If this iteration staged handler-context rules (e.g. the merged-in rule
    // carried a `color-scheme` declaration needing dark-mode fallback vars),
    // settle the pending merge before collecting those rules below: the
    // re-minify re-runs the staging declarations and stages their rules
    // again, and the per-merge re-minify this replaces also ran before
    // collection, so the re-staged entries belong in this rule's extras.
    if merge_state.pending_minify && context.handler_context.has_staged_rules() {
        flush_pending_style_merge(rules, style_rules, merge_state, context);
    }

    // Create additional rules for logical properties, @supports overrides, and incompatible selectors.
    // With no compatible selector this rule is left without one, and only the rules below get them.
    let (supps, logical) = if sty.selectors.v.is_empty() {
        Default::default()
    } else {
        let staged = &context.handler_context;
        (
            staged.get_supports_rules::<R>(Some(&sty.selectors), sty.loc),
            staged.get_additional_rules::<R>(&sty.selectors, sty.loc),
        )
    };

    struct IncompatibleRuleEntry<'bump, R> {
        rule: style::StyleRule<'bump, R>,
        supports: Vec<CssRule<'bump, R>>,
        logical: Vec<CssRule<'bump, R>>,
    }
    let mut incompatible_rules: SmallList<IncompatibleRuleEntry<R>, 1> =
        SmallList::init_capacity(incompatible.len());
    for sel in incompatible {
        let list = SelectorList {
            v: SmallList::with_one(sel),
        };
        let mut clone = style::StyleRule::<R> {
            selectors: list,
            vendor_prefix: sty.vendor_prefix,
            declarations: dc::decl_block(
                incompatible_decls.as_ref().unwrap_or(&sty.declarations),
                context.arena,
            ),
            rules: sty.rules.deep_clone(context.arena),
            loc: sty.loc,
        };
        clone.update_prefix(context);
        let staged = &context.handler_context;
        let s = staged.get_supports_rules::<R>(Some(&clone.selectors), clone.loc);
        let l = staged.get_additional_rules::<R>(&clone.selectors, clone.loc);
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
        Some(split_off_nested_rules(sty, context.arena))
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
        // the same selectors and declarations. If so, remove the earlier rule.
        if has_no_rules {
            let key = StyleRuleKey::new(rules, idx);
            if idx > 0
                && let Some(i) = style_rules.remove_duplicate(rules, &key)
                && i < rules.len()
                && let CssRule::Style(other) = &rules[i]
                && (!context.css_modules || source_index == other.loc.source_index)
                // A browser that cannot parse a value of this rule falls back to `other`.
                && let CssRule::Style(later) = &rules[idx]
                && later.declarations.eql(&other.declarations)
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
        flush_pending_style_merge(rules, style_rules, merge_state, context);
        merge_state.last_compat = None;
    }

    if !logical.is_empty() {
        let mut log = CssRuleList { v: logical };
        log.minify(context, parent_is_unused)?;
        rules.append(&mut log.v);
    }
    rules.extend(supps);
    for mut entry in incompatible_rules {
        // The same split as for `sty` above: the extra rules go before the nested rules.
        let nested = (!entry.rule.rules.v.is_empty()
            && (!entry.logical.is_empty() || !entry.supports.is_empty()))
        .then(|| split_off_nested_rules(&mut entry.rule, context.arena));
        if !entry.rule.is_empty() {
            rules.push(CssRule::Style(entry.rule));
        }
        if !entry.logical.is_empty() {
            let mut log = CssRuleList { v: entry.logical };
            log.minify(context, parent_is_unused)?;
            rules.append(&mut log.v);
        }
        rules.extend(entry.supports);
        if let Some(nested) = nested {
            rules.push(CssRule::Style(nested));
        }
    }
    if let Some(nested) = nested_rule {
        rules.push(CssRule::Style(nested));
    }

    Ok(())
}

/// Moves the nested rules of `rule` into a second rule with the same selectors and no declarations.
fn split_off_nested_rules<'bump, R>(
    rule: &mut style::StyleRule<'bump, R>,
    arena: &'bump bun_alloc::Arena,
) -> style::StyleRule<'bump, R> {
    style::StyleRule {
        selectors: rule.selectors.deep_clone(),
        declarations: crate::DeclarationBlock::new_in(arena),
        rules: core::mem::take(&mut rule.rules),
        vendor_prefix: rule.vendor_prefix,
        loc: rule.loc,
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
    fn new<R>(list: &[CssRule<R>], index: usize) -> Self {
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
    /// Inserted keys in index order. A popped rule may no longer hash to the bucket that holds it.
    keys: Vec<StyleRuleKey>,
}

impl StyleRuleKeyMap {
    /// Find and remove an earlier index whose rule `is_duplicate` of
    /// `rules[key.index]`.
    fn remove_duplicate<R>(&mut self, rules: &[CssRule<R>], key: &StyleRuleKey) -> Option<usize> {
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
    fn insert(&mut self, key: StyleRuleKey) {
        debug_assert!(self.keys.last().is_none_or(|last| last.index < key.index));
        self.buckets.entry(key.hash).or_default().push(key.index);
        self.keys.push(key);
    }

    /// Forget the rules at `len..`: the caller popped them, and other rules can take their slots.
    fn truncate(&mut self, len: usize) {
        while let Some(key) = self.keys.pop_if(|key| key.index >= len) {
            if let Some(bucket) = self.buckets.get_mut(&key.hash)
                && let Some(pos) = bucket.iter().rposition(|&index| index == key.index)
            {
                bucket.swap_remove(pos);
            }
        }
    }

    fn clear(&mut self) {
        self.buckets.clear();
        self.keys.clear();
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
fn flush_pending_style_merge<'bump, R>(
    rules: &mut Vec<CssRule<'bump, R>>,
    style_rules: &mut StyleRuleKeyMap,
    state: &mut StyleRuleMergeState,
    context: &mut MinifyContext<'_, 'bump>,
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
            context.handler,
            context.important_handler,
            &mut context.handler_context,
        );
        cascade_merge_with_previous(rules, style_rules, state, context);
    }
}

/// Try to merge the last style rule into the one before it, repeatedly, while
/// merges keep succeeding. A declaration merge leaves `state.pending_minify`
/// set, in which case the caller ([`flush_pending_style_merge`]) re-minifies
/// before cascading further.
fn cascade_merge_with_previous<'bump, R>(
    rules: &mut Vec<CssRule<'bump, R>>,
    style_rules: &mut StyleRuleKeyMap,
    state: &mut StyleRuleMergeState,
    context: &mut MinifyContext<'_, 'bump>,
) {
    // The last rule was settled before cascading, so `merge_style_rules`'s
    // pending flush (which re-minifies `dst`, i.e. `prev` here) can't fire.
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
                style_rules.truncate(rules.len());
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

/// Merge `src` into `dst` if their selectors/declarations allow. Returns
/// `true` if merged (caller should drop `src`).
///
/// `dst` is the rule that precedes `src` in the output: the forward merge in
/// `minify_style_arm` merges the incoming rule into the last emitted one, and
/// [`cascade_merge_with_previous`] merges the last emitted rule into the one
/// before it.
///
/// A declaration merge only concatenates the declaration lists and sets
/// `pending_minify`; the re-minify is deferred to the end of the merge run
/// (see [`StyleRuleMergeState`]). `pending_minify` may only be set on entry
/// when `dst` is the rule it tracks (the forward merge); the cascade always
/// settles it first. `src_compat` / `dst_compat` cache `is_compatible` for
/// `src` / `dst`.
fn merge_style_rules<'bump, R>(
    src: &mut style::StyleRule<'bump, R>,
    dst: &mut style::StyleRule<'bump, R>,
    context: &mut MinifyContext<'_, 'bump>,
    pending_minify: &mut bool,
    src_compat: &mut Option<bool>,
    dst_compat: &mut Option<bool>,
) -> bool {
    use css::VendorPrefix;
    // See `StylesheetExtra::may_revert_rule`.
    if context.extra.may_revert_rule {
        return false;
    }
    // Merge declarations if the selectors are equivalent, and both are compatible with all targets.
    // Does not apply if css modules are enabled.
    if src.selectors.eql(&dst.selectors)
        && cached_is_compatible(src, src_compat, context.targets)
        && cached_is_compatible(dst, dst_compat, context.targets)
        && src.rules.v.is_empty()
        && dst.rules.v.is_empty()
        && (!context.css_modules || src.loc.source_index == dst.loc.source_index)
    {
        dst.declarations
            .declarations
            .extend(src.declarations.declarations.drain(..));
        dst.declarations
            .important_declarations
            .extend(src.declarations.important_declarations.drain(..));
        *pending_minify = true;
        return true;
    }

    // The declaration comparison below must see the canonical (minified)
    // form, so settle any pending merged declarations first.
    if *pending_minify {
        *pending_minify = false;
        dst.declarations.minify(
            context.handler,
            context.important_handler,
            &mut context.handler_context,
        );
    }

    if src.declarations.eql(&dst.declarations) && src.rules.v.is_empty() && dst.rules.v.is_empty() {
        // If both selectors are potentially vendor prefixable, and they are
        // equivalent minus prefixes, add the prefix to the last rule.
        if !src.vendor_prefix.is_empty()
            && !dst.vendor_prefix.is_empty()
            && css::selector::is_equivalent(src.selectors.v.slice(), dst.selectors.v.slice())
        {
            if src.vendor_prefix.contains(VendorPrefix::NONE)
                && context.targets.should_compile_selectors()
            {
                dst.vendor_prefix = src.vendor_prefix;
            } else {
                dst.vendor_prefix.insert(src.vendor_prefix);
            }
            return true;
        }

        // Append the selectors to the last rule if the declarations are the same, and all selectors are compatible.
        // The rules staged for `src` still need its selectors.
        if !context.handler_context.has_staged_rules()
            && cached_is_compatible(src, src_compat, context.targets)
            && cached_is_compatible(dst, dst_compat, context.targets)
        {
            let moved = core::mem::take(&mut src.selectors.v);
            // `reserve` (not `ensure_total_capacity`) so capacity grows
            // super-linearly across repeated merges, keeping the N-way merge
            // amortized O(N).
            dst.selectors.v.reserve(moved.len());
            for sel in moved {
                dst.selectors.v.append_assume_capacity(sel);
            }
            // Both sides were just proven compatible, so the combined selector
            // list is too.
            *dst_compat = Some(true);
            if src.vendor_prefix.contains(VendorPrefix::NONE)
                && context.targets.should_compile_selectors()
            {
                dst.vendor_prefix = src.vendor_prefix;
            } else {
                dst.vendor_prefix.insert(src.vendor_prefix);
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

/// Nesting cursor of the rule printers — linked list of parent selector lists used to
/// resolve `&` during serialization.
pub struct StyleContext<'a, 'bump> {
    pub(crate) selectors: &'a crate::selectors::SelectorList<'bump>,
    pub(crate) parent: Option<&'a StyleContext<'a, 'bump>>,
    /// The vendor prefix pass in which the rule of `selectors` prints its block.
    pub(crate) vendor_prefix: crate::VendorPrefix,
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
pub(crate) const MAX_SELECTOR_EXPANSION: u32 = 65_536;

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
    pub(crate) arena: &'bump bun_alloc::Arena,
    pub(crate) targets: &'a css::targets::Targets,
    pub(crate) handler: &'a mut css::DeclarationHandler<'bump>,
    pub(crate) important_handler: &'a mut css::DeclarationHandler<'bump>,
    pub(crate) handler_context: css::PropertyHandlerContext<'a, 'bump>,
    /// Class/id names known to be unused (tree-shaking input).
    // `selector::is_unused` currently borrows `&ArrayHashMap<&[u8], ()>`; the
    // owning `MinifyOptions` stores `Box<[u8]>` keys — reconcile to a
    // single key type with `Borrow<[u8]>` lookup.
    pub(crate) unused_symbols: &'a bun_collections::ArrayHashMap<Box<[u8]>, ()>,
    /// Pre-scanned `@custom-media` definitions, if the feature is enabled.
    pub(crate) custom_media:
        Option<bun_collections::ArrayHashMap<Box<[u8]>, custom_media::CustomMediaRule<'bump>>>,
    pub(crate) extra: &'a css::StylesheetExtra,
    pub(crate) css_modules: bool,
    /// First minification error encountered (surfaced out-of-band).
    pub(crate) err: Option<css::error::MinifyError>,
    /// How many copies of the current rule's selectors compiling the enclosing
    /// nesting for the targets will produce — the product of the enclosing
    /// style rules' selector-list lengths. `1` at the top level.
    pub(crate) selector_expansion_multiplier: u32,
    /// Running total of selectors that compiling nested rules for the targets
    /// will expand to, checked against [`MAX_SELECTOR_EXPANSION`].
    pub(crate) selector_expansion_total: u32,
}

impl MinifyContext<'_, '_> {
    /// See `StyleRule::charge_selector_expansion`. The rule at `loc` prints `selectors` selectors.
    pub(crate) fn charge_selector_expansion(
        &mut self,
        selectors: u32,
        loc: Location,
    ) -> Result<(), MinifyErr> {
        if self.selector_expansion_multiplier > 1 {
            self.selector_expansion_total = self.selector_expansion_total.saturating_add(
                self.selector_expansion_multiplier
                    .saturating_mul(selectors.max(1)),
            );
            if self.selector_expansion_total > MAX_SELECTOR_EXPANSION {
                self.err = Some(crate::error::MinifyError {
                    kind: crate::error::MinifyErrorKind::selector_expansion_limit_exceeded,
                    loc,
                });
                return Err(MinifyErr::minify_err);
            }
        }
        Ok(())
    }
}
