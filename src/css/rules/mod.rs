use crate as css;

use css::PrintErr;
use css::Printer;
use css::error::MinifyErr;

// ─── B-2 round 6 status ────────────────────────────────────────────────────
// Hub un-gated. `CssRule` / `CssRuleList` / `MinifyContext` are real and
// `CssRuleList::{to_css,minify}` now compile so `StyleSheet::{minify,to_css}`
// can call through. All leaf-rule `to_css` impls are now real — the
// `to_css_shim!` ladder is gone. The heavy `.style` minify arm and
// `merge_style_rules` body stay `` internally on
// `StyleRule::{minify,is_compatible,update_prefix,hash_key,is_duplicate}` +
// selector helpers.

macro_rules! gated_rule {
    ($name:ident) => {
         pub mod $name;
        #[cfg(any())] pub mod $name {}
    };
    ($name:ident, { $($body:tt)* }) => {
         pub mod $name;
        #[cfg(any())] pub mod $name { $($body)* }
    };
}

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
gated_rule!(tailwind, {
    /// `@tailwind base|components|utilities|variants;`
    // PORT NOTE: spec `TailwindAtRule` is a struct `{ style_name, loc }`; the
    // four-variant enum is `TailwindStyleName`. Stub mirrors that shape so
    // `css_parser::AtRulePrelude` carries source-location info when un-gated.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum TailwindStyleName {
        Base,
        Components,
        Utilities,
        Variants,
    }
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct TailwindAtRule {
        pub style_name: TailwindStyleName,
        pub loc: super::Location,
    }
});

// ─── CssRule / CssRuleList ─────────────────────────────────────────────────
// Zig: pub fn CssRule(comptime Rule: type) type { return union(enum) { ... } }
//
// PORT NOTE: the original port threaded a `'bump` arena lifetime through every
// rule (matching Zig's `ArrayListUnmanaged`-backed AST). That cascades into
// every leaf module signature; while those leaves are gated, `CssRule<R>` is
// kept lifetime-free here (the gated bodies re-introduce `'bump` when they
// un-gate alongside `bumpalo::collections::Vec` storage).

/// A single CSS rule (at-rule or style rule).
pub enum CssRule<R> {
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
    /// A placeholder for a rule that was removed.
    Ignored,
    /// An unknown at-rule.
    Unknown(unknown::UnknownAtRule),
    /// A custom at-rule.
    Custom(R),
}

/// Zig: pub fn CssRuleList(comptime AtRule: type) type { return struct { ... } }
pub struct CssRuleList<R> {
    // PERF(port): was `bumpalo::collections::Vec<'bump, CssRule<'bump, R>>`;
    // arena threading restored when leaf rules un-gate.
    pub v: Vec<CssRule<R>>,
}

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
use style::StyleRule;

// ─── leaf-rule deep_clone ──────────────────────────────────────────────────
// Every leaf module now owns a real inherent `deep_clone` body — the field-
// wise / variant-wise port of `css.implementDeepClone`. `CssRule::deep_clone`
// (below) dispatches via method-syntax so it picks up the inherent impl.
//
// PORT NOTE: most leaf rules can't use `#[derive(DeepClone)]` directly yet
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
    /// PORT NOTE: threads the real `'bump` lifetime instead of fabricating
    /// `'static` (PORTING.md §Forbidden: `unsafe { &*(p as *const _) }` to
    /// extend a lifetime). Callers whose storage is still pinned to
    /// `DeclarationBlock<'static>` must fix that storage type — the lie
    /// belongs there, not here, and collapses when `CssRule<'bump, R>`
    /// re-threads the arena lifetime.
    #[inline]
    pub fn decl_block<'bump>(
        this: &crate::DeclarationBlock<'bump>,
        bump: &'bump Arena,
    ) -> crate::DeclarationBlock<'bump> {
        crate::DeclarationBlock {
            important_declarations: bun_alloc::ArenaVec::from_iter_in(
                this.important_declarations.iter().map(|p| property(p, bump)),
                bump,
            ),
            declarations: bun_alloc::ArenaVec::from_iter_in(
                this.declarations.iter().map(|p| property(p, bump)),
                bump,
            ),
        }
    }

    /// `'bump`-erasure adaptor for [`decl_block`].
    ///
    /// SAFETY: `DeclarationBlock<'static>` is the crate-wide `'bump`-erasure
    /// placeholder until `CssRule<'bump, R>` re-threads the arena lifetime
    /// (see `style.rs` struct PORT NOTE). `bumpalo::Vec` is invariant in
    /// `'bump`, so the input reborrow and the output both require the same
    /// erasure. Both sides point into the same arena that owns the source
    /// block; lifetimes re-thread together when the rule structs grow a
    /// real `'bump` parameter — at which point all callers move back to
    /// [`decl_block`] and this helper is deleted.
    #[inline]
    pub fn decl_block_static(
        this: &crate::DeclarationBlock<'static>,
        bump: &Arena,
    ) -> crate::DeclarationBlock<'static> {
        unsafe {
            core::mem::transmute::<crate::DeclarationBlock<'_>, crate::DeclarationBlock<'static>>(
                decl_block(this, core::mem::transmute::<&Arena, &'static Arena>(bump)),
            )
        }
    }

    /// `MediaList::deep_clone` — routes to the real arena-aware impl in
    /// media_query.rs (element-wise walk of `media_queries`).
    #[inline]
    pub fn media_list(this: &crate::media_query::MediaList, bump: &Arena) -> crate::media_query::MediaList {
        this.deep_clone(bump)
    }

    /// `SelectorList::deep_clone` — selectors/parser.rs intentionally drops
    /// the `&Arena` parameter (its slices are arena-static). Adapt the call
    /// shape so leaf rules can stay uniform.
    #[inline]
    pub fn selector_list(
        this: &crate::selectors::SelectorList,
        _bump: &Arena,
    ) -> crate::selectors::SelectorList {
        this.deep_clone()
    }

    /// `QueryFeature<F>::deep_clone` — routes to the real arena-aware impl in
    /// media_query.rs (variant-wise walk recursing into `MediaFeatureValue`).
    #[inline]
    pub fn query_feature<F>(
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
    pub fn property(this: &crate::properties::Property, bump: &Arena) -> crate::properties::Property {
        this.deep_clone(bump)
    }
}

// `Location` is plain `Copy` data; the derive expands to field-wise
// `u32::deep_clone` (identity). Doubles as the in-tree smoke test that the
// `#[derive(DeepClone)]` proc-macro round-trips through a real CSS type.
// (The Zig `implementDeepClone` returns `this.*` for simple-copy types.)

// ─── shared serialization helpers for leaf rules ──────────────────────────
// Several leaf-rule `to_css` bodies bottom out on helpers whose canonical
// homes are still ``-gated outside `rules/` (DeclarationBlock::
// to_css_block, VendorPrefix::toCss, CustomIdent/DashedIdent ::toCss). The
// bodies are tiny and have no further blockers, so they're inlined here so the
// 12 leaf rules can serialize for real. Once the upstream gates drop, callers
// switch back and these are deleted.

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
    let v = unsafe { &*ident.v };
    // blocked_on: Printer::write_ident — css-module custom-ident scoping path
    // is gated; fall through to its unscoped tail.
    
    {
        let enabled = dest.css_module.as_ref().is_some_and(|m| m.config.custom_idents);
        return dest.write_ident(v, enabled);
    }
    css::serializer::serialize_identifier(v, dest).map_err(|_| dest.add_fmt_error())
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
    // SAFETY: DashedIdent.v points into the parser arena which outlives the AST.
    let v = unsafe { &*ident.v };
    dest.write_str("--")?;
    // blocked_on: Printer::write_dashed_ident — css-module dashed-ident scoping
    // path is gated; fall through to the unscoped tail it shares.
    css::serializer::serialize_name(&v[2..], dest).map_err(|_| dest.add_fmt_error())
}

/// Shim: `MediaRule::minify` is gated in `media.rs` until that file's full
/// `to_css` body un-gates. Recurse into the nested list and report whether the
/// rule should be dropped. NOTE: `never_matches()` is a *drop condition*, not
/// merely an optimization — omitting it diverges output (e.g. `@media not all
/// { a{color:red} }` must be removed). `MediaList::never_matches` is un-gated,
/// so call it here to match the spec (`media.zig:19-23`).
impl<R> media::MediaRule<R> {
    pub fn minify(
        &mut self,
        context: &mut MinifyContext<'_>,
        parent_is_unused: bool,
    ) -> Result<bool, MinifyErr>
    where
        R: for<'b> css::generics::DeepClone<'b>,
    {
        self.rules.minify(context, parent_is_unused)?;
        Ok(self.rules.v.is_empty() || self.query.never_matches())
    }
}

// ─── CssRule::to_css ──────────────────────────────────────────────────────

impl<R> CssRule<R> {
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
            // Zig: `.custom => |x| x.toCss(dest) catch return dest.addFmtError()`.
            //
            // PORT NOTE (incomplete): the spec has TWO concrete `R` types —
            // `DefaultAtRule` (whose `toCss` errors unconditionally) and
            // `TailwindAtRule` (src/css/rules/tailwind.zig:14-19, used via
            // `BundlerAtRule` when `ENABLE_TAILWIND_PARSING`), whose `toCss`
            // SUCCEEDS and writes `@tailwind <name>;`. This arm therefore
            // diverges from the spec for `R = TailwindAtRule`: it fails
            // serialization where the spec round-trips.
            //
            // The correct port threads a `ToCss`-style bound (or per-`R`
            // vtable) so `Custom(x)` dispatches to `x.to_css(dest)` and only
            // maps the error path via `add_fmt_error()`. That bound cascades
            // through every nested `CssRuleList<R>` printer (media, supports,
            // layer, document, nesting, starting_style, style, scope,
            // container) — deferred to the patch that un-gates
            // `BundlerAtRule = TailwindAtRule`.
            // TODO(port): dispatch to `x.to_css(dest)` once `R: ToCss` (or
            // equivalent) is threaded; current behavior is only spec-correct
            // for `R = DefaultAtRule`.
            CssRule::Custom(_x) => Err(dest.add_fmt_error()),
            CssRule::Ignored => Ok(()),
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

            // Skip @import rules if collecting dependencies.
            if let CssRule::Import(import_rule) = rule
                && dest.remove_imports
            {
                let dep = if dest.dependencies.is_some() {
                    Some(css::dependencies::Dependency::Import(
                        css::dependencies::ImportDependency::new(
                            dest.allocator,
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
        context: &mut MinifyContext<'_>,
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
                    CssRule::Container(_cont) => {
                        // TODO(port): ContainerRule minify — Zig fallthrough.
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
                    CssRule::MozDocument(_doc) => {
                        // TODO(port): MozDocumentRule minify — Zig fallthrough.
                    }
                    CssRule::Style(_sty) => {
                        // The full `.style` arm (selector compat partitioning,
                        // merge-with-previous, logical/@supports expansion,
                        // dedup via StyleRuleKey, nested-rule split) bottoms
                        // out on the gated StyleRule behavior surface. Until
                        // that un-gates, fall through and keep the rule as-is.
                        
                        {
                            minify_style_arm(rule, &mut rules, &mut style_rules, context, parent_is_unused)?;
                            break 'arm;
                        }
                    }
                    CssRule::CounterStyle(_) => { /* TODO(port): Zig fallthrough */ }
                    CssRule::Scope(_) => { /* TODO(port): Zig fallthrough */ }
                    CssRule::Nesting(_) => { /* TODO(port): Zig fallthrough */ }
                    CssRule::StartingStyle(_) => { /* TODO(port): Zig fallthrough */ }
                    CssRule::FontPaletteValues(_) => { /* TODO(port): Zig fallthrough */ }
                    CssRule::Property(_) => { /* TODO(port): Zig fallthrough */ }
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

        // Zig: css.deepDeinit(CssRule(AtRule), context.allocator, &this.v);
        // Rust drops the old Vec on assignment.
        self.v = rules;
        Ok(())
    }

    /// Zig: `css.implementDeepClone(@This(), this, allocator)`.
    pub fn deep_clone<'bump>(&self, bump: &'bump bun_alloc::Arena) -> Self
    where
        R: css::generics::DeepClone<'bump>,
    {
        Self { v: self.v.iter().map(|r| r.deep_clone(bump)).collect() }
    }
}

impl<R> CssRule<R> {
    /// Zig: `css.implementDeepClone(@This(), this, allocator)` — variant-wise
    /// dispatch to each leaf rule's `deep_clone`. Hand-written (not
    /// `#[derive(DeepClone)]`) because the leaf payloads expose `deep_clone`
    /// as **inherent** methods rather than `DeepClone` trait impls during the
    /// staggered Phase-B un-gate; method-syntax dispatch here picks up either.
    pub fn deep_clone<'bump>(&self, bump: &'bump bun_alloc::Arena) -> Self
    where
        R: css::generics::DeepClone<'bump>,
    {
        #[allow(unused_imports)]
        use css::generics::DeepClone as _;
        match self {
            CssRule::Media(x) => CssRule::Media(x.deep_clone(bump)),
            CssRule::Import(x) => CssRule::Import(x.deep_clone(bump)),
            CssRule::Style(x) => CssRule::Style(x.deep_clone(bump)),
            CssRule::Keyframes(x) => CssRule::Keyframes(x.deep_clone(bump)),
            CssRule::FontFace(x) => CssRule::FontFace(x.deep_clone(bump)),
            CssRule::FontPaletteValues(x) => CssRule::FontPaletteValues(x.deep_clone(bump)),
            CssRule::Page(x) => CssRule::Page(x.deep_clone(bump)),
            CssRule::Supports(x) => CssRule::Supports(x.deep_clone(bump)),
            CssRule::CounterStyle(x) => CssRule::CounterStyle(x.deep_clone(bump)),
            CssRule::Namespace(x) => CssRule::Namespace(x.deep_clone(bump)),
            CssRule::MozDocument(x) => CssRule::MozDocument(x.deep_clone(bump)),
            CssRule::Nesting(x) => CssRule::Nesting(x.deep_clone(bump)),
            CssRule::Viewport(x) => CssRule::Viewport(x.deep_clone(bump)),
            CssRule::CustomMedia(x) => CssRule::CustomMedia(x.deep_clone(bump)),
            CssRule::LayerStatement(x) => CssRule::LayerStatement(x.deep_clone(bump)),
            CssRule::LayerBlock(x) => CssRule::LayerBlock(x.deep_clone(bump)),
            CssRule::Property(x) => CssRule::Property(x.deep_clone(bump)),
            CssRule::Container(x) => CssRule::Container(x.deep_clone(bump)),
            CssRule::Scope(x) => CssRule::Scope(x.deep_clone(bump)),
            CssRule::StartingStyle(x) => CssRule::StartingStyle(x.deep_clone(bump)),
            CssRule::Unknown(x) => CssRule::Unknown(x.deep_clone(bump)),
            CssRule::Custom(x) => CssRule::Custom(x.deep_clone(bump)),
            CssRule::Ignored => CssRule::Ignored,
        }
    }
}

// ── `.style` arm body — preserved verbatim port, gated on StyleRule
// behavior + selector helpers + DeclarationBlock::deep_clone. ──

fn minify_style_arm<R: for<'b> css::generics::DeepClone<'b>>(
    rule: &mut CssRule<R>,
    rules: &mut Vec<CssRule<R>>,
    style_rules: &mut StyleRuleKeyMap,
    context: &mut MinifyContext<'_>,
    parent_is_unused: bool,
) -> Result<(), MinifyErr> {
    use css::SmallList;
    use css::selector::{self, Component, Selector, SelectorList};
    let CssRule::Style(sty) = rule else { unreachable!() };

    if parent_is_unused || sty.minify(context, parent_is_unused)? {
        return Ok(());
    }

    // If some of the selectors in this rule are not compatible with the targets,
    // we need to either wrap in :is() or split them into multiple rules.
    let mut incompatible: SmallList<Selector, 1> = if sty.selectors.v.len() > 1
        && context.targets.should_compile_selectors()
        && !sty.is_compatible(*context.targets)
    {
        // The :is() selector accepts a forgiving selector list, so use that if possible.
        // Note that :is() does not allow pseudo elements, so we need to check for that.
        // In addition, :is() takes the highest specificity of its arguments, so if the selectors
        // have different weights, we need to split them into separate rules as well.
        if context.targets.is_compatible(css::compat::Feature::IsSelector)
            && !sty.selectors.any_has_pseudo_element()
            && sty.selectors.specifities_all_equal()
        {
            let component = Component::Is(
                core::mem::take(&mut sty.selectors.v).to_owned_slice(),
            );
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
                if selector::is_compatible(&sty.selectors.v.slice()[i as usize..i as usize + 1], *context.targets) {
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
        let list = SelectorList { v: SmallList::with_one(sel) };
        let mut clone = style::StyleRule::<R> {
            selectors: list,
            vendor_prefix: sty.vendor_prefix,
            declarations: sty.declarations.deep_clone(context.allocator),
            rules: sty.rules.deep_clone(context.allocator),
            loc: sty.loc,
        };
        clone.update_prefix(context);
        let s = context.handler_context.get_supports_rules::<R>(&clone);
        let l = context.handler_context.get_additional_rules::<R>(&clone);
        incompatible_rules.append(IncompatibleRuleEntry { rule: clone, supports: s, logical: l });
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
        // SAFETY: Phase-A 'static erasure on `DeclarationBlock<'static>` —
        // matches existing pattern in declaration.rs / css_parser.rs.
        let bump: &'static bumpalo::Bump =
            unsafe { &*(context.allocator as *const bun_alloc::Arena) };
        Some(style::StyleRule {
            selectors: sty.selectors.deep_clone(),
            declarations: css::DeclarationBlock::new_in(bump),
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

// ─── StyleRuleKey ──────────────────────────────────────────────────────────
/// A key to a `StyleRule` meant for use in a hash map for quickly detecting
/// duplicates. It stores an index into the live `rules` Vec plus a
/// pre-computed hash for fast lookups.
///
/// PORT NOTE: the Zig spec (`rules.zig:StyleRuleKey`) additionally stores
/// `list: *const ArrayList(CssRule(R))` and dereferences it inside `eql()`.
/// That pattern is unsound in Rust under Stacked/Tree Borrows — keys persist
/// in the dedup map across iterations of `minify_style_arm`, and between
/// iterations the same `Vec` is written through fresh `&mut` reborrows
/// (`rules.push`, `rules[i] = Ignored`), invalidating any previously-derived
/// `*const Vec` provenance. Instead we keep only `(index, hash)` here and do
/// the equality check in `StyleRuleKeyMap::remove_duplicate`, which receives
/// the live `&[CssRule<R>]` slice explicitly at the call site.
#[derive(Clone, Copy)]
pub struct StyleRuleKey {
    index: usize,
    hash: u64,
}

impl StyleRuleKey {
    pub fn new<R>(list: &[CssRule<R>], index: usize) -> Self {
        let hash = match &list[index] {
            CssRule::Style(rule) => rule.hash_key(),
            _ => 0,
        };
        Self { index, hash }
    }
}

/// Dedup table for [`StyleRuleKey`]s — the Rust-side equivalent of Zig's
/// `StyleRuleKey(R).HashMap(usize)`.
///
/// Buckets keyed by the pre-computed `StyleRule::hash_key()` hold indices into
/// the caller's `rules` Vec; equality (`StyleRule::is_duplicate`) is evaluated
/// against an explicitly-passed `&[CssRule<R>]` so we never smuggle a stale
/// raw pointer across `&mut rules` writes (see PORT NOTE on `StyleRuleKey`).
#[derive(Default)]
pub struct StyleRuleKeyMap {
    buckets: std::collections::HashMap<u64, Vec<usize>>,
}

impl StyleRuleKeyMap {
    /// Zig `style_rules.fetchSwapRemove(key)` — find and remove an earlier
    /// index whose rule `is_duplicate` of `rules[key.index]`.
    pub fn remove_duplicate<R>(
        &mut self,
        rules: &[CssRule<R>],
        key: &StyleRuleKey,
    ) -> Option<usize> {
        let bucket = self.buckets.get_mut(&key.hash)?;
        let CssRule::Style(rule) = &rules[key.index] else { return None };
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

    /// Zig `style_rules.put(ctx.allocator, key, idx)`.
    pub fn insert(&mut self, key: StyleRuleKey) {
        self.buckets.entry(key.hash).or_default().push(key.index);
    }

    pub fn clear(&mut self) {
        self.buckets.clear();
    }
}

// ─── merge_style_rules ─────────────────────────────────────────────────────

/// Merge `sty` into `last_style_rule` if their selectors/declarations allow.
/// Returns `true` if merged (caller should drop `sty`).
pub fn merge_style_rules<R>(
    sty: &mut style::StyleRule<R>,
    last_style_rule: &mut style::StyleRule<R>,
    context: &mut MinifyContext<'_>,
) -> bool {
    use css::VendorPrefix;
        // Merge declarations if the selectors are equivalent, and both are compatible with all targets.
        // Does not apply if css modules are enabled.
        if sty.selectors.eql(&last_style_rule.selectors)
            && sty.is_compatible(*context.targets)
            && last_style_rule.is_compatible(*context.targets)
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
            if sty.is_compatible(*context.targets) && last_style_rule.is_compatible(*context.targets) {
                while sty.selectors.v.len() > 0 {
                    last_style_rule
                        .selectors
                        .v
                        .append(sty.selectors.v.ordered_remove(0));
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

/// Cross-source location (carries a source-map source index). Same layout as
/// `crate::Location` — kept as a distinct type here to match the Zig surface
/// (`css_rules.Location` vs `css.Location`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, css::DeepClone)]
pub struct Location {
    /// The index of the source file within the source map.
    pub source_index: u32,
    /// The line number, starting at 0.
    pub line: u32,
    /// The column number within a line, starting at 1. Counted in UTF-16 code units.
    pub column: u32,
}

impl Location {
    pub fn dummy() -> Location {
        Location { source_index: u32::MAX, line: u32::MAX, column: u32::MAX }
    }
}

/// Printer's nesting cursor — linked list of parent selector lists used to
/// resolve `&` during serialization.
pub struct StyleContext<'a> {
    pub selectors: &'a crate::selectors::SelectorList,
    pub parent: Option<&'a StyleContext<'a>>,
}

/// Per-stylesheet minification state threaded through `CssRuleList::minify`
/// and every leaf rule's `minify`.
///
/// PORT NOTE: Zig carried `allocator: std.mem.Allocator` for the AST arena;
/// here that is `&'a Arena` (bumpalo). All sub-allocations during minify go
/// through it so the whole transformed tree is bulk-freed with the arena.
pub struct MinifyContext<'a> {
    /// Arena that owns the AST being minified (same allocator it was parsed into).
    pub allocator: &'a bun_alloc::Arena,
    pub targets: &'a css::targets::Targets,
    pub handler: &'a mut css::DeclarationHandler<'a>,
    pub important_handler: &'a mut css::DeclarationHandler<'a>,
    pub handler_context: css::PropertyHandlerContext<'a>,
    /// Class/id names known to be unused (tree-shaking input).
    // PORT NOTE: Zig `*const std.StringArrayHashMapUnmanaged(void)`.
    // `selector::is_unused` currently borrows `&ArrayHashMap<&[u8], ()>`; the
    // owning `MinifyOptions` stores `Box<[u8]>` keys — reconcile when
    // `style.rs::minify` un-gates (single key type, `Borrow<[u8]>` lookup).
    pub unused_symbols: &'a bun_collections::ArrayHashMap<Box<[u8]>, ()>,
    /// Pre-scanned `@custom-media` definitions, if the feature is enabled.
    pub custom_media:
        Option<bun_collections::ArrayHashMap<Box<[u8]>, custom_media::CustomMediaRule>>,
    pub extra: &'a css::StylesheetExtra,
    pub css_modules: bool,
    /// First minification error encountered (Zig surfaced this out-of-band).
    pub err: Option<css::error::MinifyError>,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/rules.zig (681 lines)
//   confidence: medium
//   todos:      4
//   notes:      hub un-gated; CssRule<R> + CssRuleList::{to_css,minify,deep_clone} + MinifyContext + StyleRuleKey + merge_style_rules real; all leaf-rule to_css impls real — to_css_shim! deleted; minify .style arm + merge_style_rules body + StyleRuleKey hash/eq internally gated on StyleRule behavior + selector helpers; 'bump arena lifetime dropped from CssRuleList until crate-wide thread
// ──────────────────────────────────────────────────────────────────────────
