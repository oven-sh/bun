use crate as css;

use css::PrintErr;
use css::Printer;

// ─── B-2 round 3 status ────────────────────────────────────────────────────
// Hub un-gated. Every leaf rule module (`style`, `media`, `supports`,
// `keyframes`, `font_face`, ...) bottoms out on `declaration::DeclarationBlock`,
// `selectors::parser` (real grammar), `properties_generated`, and the
// `values/` calc lattice — all still gated. The leaves stay
// `#[cfg(any())]`-gated below and re-expose data-only stubs for the types
// `css_parser::AtRulePrelude` / `TopLevelRuleParser` reach into by name. The
// `CssRule` enum is real (so `css_parser` can construct/match it) but every
// variant payload is the stub from its gated submodule; the heavy `to_css`/
// `minify` impl bodies are `#[cfg(any())]`-gated until the leaves un-gate.

macro_rules! gated_rule {
    ($name:ident) => {
        #[cfg(any())] pub mod $name;
        #[cfg(not(any()))] pub mod $name {}
    };
    ($name:ident, { $($body:tt)* }) => {
        #[cfg(any())] pub mod $name;
        #[cfg(not(any()))] pub mod $name { $($body)* }
    };
}

gated_rule!(import, {
    /// `@import` rule. Data-only stub of `rules/import.rs::ImportRule`.
    #[derive(Default)]
    pub struct ImportRule {
        pub url: &'static [u8],
        pub import_record_idx: u32,
        pub supports: Option<super::supports::SupportsCondition>,
        pub media: crate::media_query::MediaList,
        pub layer: Option<Option<super::layer::LayerName>>,
        pub loc: super::Location,
    }
    /// `layer(...) supports(...) <media>` tail of an `@import`.
    #[derive(Default)]
    pub struct ImportConditions;
});
gated_rule!(layer, {
    use crate::SmallList;
    /// Dotted layer name (`a.b.c`). `SmallList<[]const u8, 1>` newtype.
    #[derive(Default)]
    pub struct LayerName {
        pub v: SmallList<&'static [u8], 1>,
    }
    /// `@layer a, b.c;` statement form.
    #[derive(Default)]
    pub struct LayerStatementRule {
        pub names: SmallList<LayerName, 1>,
        pub loc: super::Location,
    }
    /// `@layer name { ... }` block form.
    pub struct LayerBlockRule<R> {
        pub name: Option<LayerName>,
        pub rules: super::CssRuleList<R>,
        pub loc: super::Location,
    }
});
gated_rule!(style, {
    /// A style rule (selector list + declaration block + nested rules).
    pub struct StyleRule<R> {
        pub selectors: crate::selectors::SelectorList,
        pub vendor_prefix: crate::VendorPrefix,
        pub declarations: crate::css_parser::DeclarationBlock,
        pub rules: super::CssRuleList<R>,
        pub loc: super::Location,
    }
});
gated_rule!(keyframes, {
    #[derive(Default)]
    pub struct KeyframesRule;
});
gated_rule!(font_face, {
    #[derive(Default)]
    pub struct FontFaceRule;
});
gated_rule!(font_palette_values, {
    #[derive(Default)]
    pub struct FontPaletteValuesRule;
});
gated_rule!(page, {
    #[derive(Default)]
    pub struct PageRule;
});
gated_rule!(supports, {
    /// `@supports` condition tree.
    #[derive(Default, Clone)]
    pub struct SupportsCondition;
    /// `@supports (...) { ... }` block.
    pub struct SupportsRule<R> {
        pub condition: SupportsCondition,
        pub rules: super::CssRuleList<R>,
        pub loc: super::Location,
    }
});
gated_rule!(counter_style, {
    #[derive(Default)]
    pub struct CounterStyleRule;
});
gated_rule!(custom_media, {
    /// `@custom-media --name <media-list>;`
    #[derive(Clone)]
    pub struct CustomMediaRule {
        pub name: crate::values::ident::DashedIdent,
        pub query: crate::media_query::MediaList,
        pub loc: super::Location,
    }
});
gated_rule!(namespace, {
    #[derive(Default)]
    pub struct NamespaceRule;
});
gated_rule!(unknown, {
    /// An at-rule the parser didn't recognize. Preserved as raw token list.
    #[derive(Default)]
    pub struct UnknownAtRule {
        pub name: &'static [u8],
        pub prelude: crate::properties::custom::TokenList,
        pub block: Option<crate::properties::custom::TokenList>,
        pub loc: super::Location,
    }
});
gated_rule!(document, {
    pub struct MozDocumentRule<R> {
        pub rules: super::CssRuleList<R>,
        pub loc: super::Location,
    }
});
gated_rule!(nesting, {
    pub struct NestingRule<R> {
        pub style: super::style::StyleRule<R>,
        pub loc: super::Location,
    }
});
gated_rule!(viewport, {
    #[derive(Default)]
    pub struct ViewportRule;
});
gated_rule!(property, {
    #[derive(Default)]
    pub struct PropertyRule;
});
gated_rule!(container, {
    pub struct ContainerRule<R> {
        pub rules: super::CssRuleList<R>,
        pub loc: super::Location,
    }
});
gated_rule!(scope, {
    pub struct ScopeRule<R> {
        pub rules: super::CssRuleList<R>,
        pub loc: super::Location,
    }
});
gated_rule!(media, {
    pub struct MediaRule<R> {
        pub query: crate::media_query::MediaList,
        pub rules: super::CssRuleList<R>,
        pub loc: super::Location,
    }
});
gated_rule!(starting_style, {
    pub struct StartingStyleRule<R> {
        pub rules: super::CssRuleList<R>,
        pub loc: super::Location,
    }
});
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

// ── heavy impl bodies (to_css / minify / merge_style_rules / StyleRuleKey)
// stay gated on the leaf rule modules + `declaration` + `context`. The full
// 600-line port is preserved in git history (rev 8b7b16543a) and re-lands
// when those siblings un-gate. ──
#[cfg(any())]
const _: () = {
    compile_error!("rules:: to_css/minify bodies — gated on declaration/context/leaf rules");
};

// ─── Location / StyleContext / MinifyContext ──────────────────────────────

/// Cross-source location (carries a source-map source index). Same layout as
/// `crate::Location` — kept as a distinct type here to match the Zig surface
/// (`css_rules.Location` vs `css.Location`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
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

/// Minification context. Stub: the real struct carries `DeclarationHandler`/
/// `PropertyHandlerContext` references which live in the still-gated
/// `declaration`/`context` modules.
pub struct MinifyContext<'a> {
    pub targets: &'a css::targets::Targets,
    pub css_modules: bool,
    // remaining fields gated on declaration/context un-gate
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/rules.zig (681 lines)
//   confidence: medium
//   todos:      4
//   notes:      hub un-gated; leaf rule modules internally gated on declaration/context/values lattice; CssRule<R> real (data-only payloads), to_css/minify bodies gated; 'bump arena lifetime dropped from CssRuleList until leaves un-gate
// ──────────────────────────────────────────────────────────────────────────
