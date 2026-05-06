#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// Allow `use bun_css as css;` from inside the crate — the ported submodules
// were translated against the crate's public surface and refer to it by name.
extern crate self as bun_css;
// AUTOGEN: mod declarations only — real exports added in B-1.
//
// B-2 un-gating in progress: leaf modules compile for real; the heavily
// inter-dependent hub modules (css_parser, properties/, rules/, values/,
// selectors/, declaration, generics, media_query, printer, context,
// css_modules, small_list, dependencies, error) remain gated behind
// `#[cfg(any())]` until the cross-module re-export web is untangled in a
// follow-up B-2 round.

macro_rules! gated_mod {
    ($name:ident, $path:literal) => {
        #[cfg(any())]
        #[path = $path]
        pub mod $name;
        #[cfg(not(any()))]
        pub mod $name {}
    };
    ($name:ident, $path:literal, { $($body:tt)* }) => {
        #[cfg(any())]
        #[path = $path]
        pub mod $name;
        #[cfg(not(any()))]
        pub mod $name { $($body)* }
    };
}

// ─── B-2 un-gated modules ─────────────────────────────────────────────────
#[path = "logical.rs"]
pub mod logical;
#[path = "sourcemap.rs"]
pub mod sourcemap;
#[path = "compat.rs"]
pub mod compat;
#[path = "prefixes.rs"]
pub mod prefixes;
#[path = "targets.rs"]
pub mod targets;

#[path = "error.rs"]
pub mod error;
#[path = "dependencies.rs"]
pub mod dependencies;
#[path = "css_modules.rs"]
pub mod css_modules;
#[path = "small_list.rs"]
pub mod small_list;
pub use small_list::SmallList;

// ─── B-2 round 3: rule-tree hubs un-gated ─────────────────────────────────
// `properties/`, `rules/`, `selectors/`, `media_query` now compile for real
// at the hub level. Each hub's mod.rs internally gates its heavy leaf
// submodules (which depend on the still-gated `values/` calc lattice +
// `declaration`/`context`) and exposes data-only stubs for the cross-module
// surface (`CssRule`, `CssRuleList`, `SelectorList`, `MediaList`,
// `PropertyId`, ...) so `css_parser::AtRulePrelude` / `TopLevelRuleParser`
// can flip to the real paths in a follow-up round.
#[path = "properties/mod.rs"]
pub mod properties;
#[path = "rules/mod.rs"]
pub mod rules;
#[path = "selectors/mod.rs"]
pub mod selectors;
#[path = "media_query.rs"]
pub mod media_query;

// ─── B-2 round 4: declaration/context un-gated ────────────────────────────
// `DeclarationBlock` / `DeclarationList` / `DeclarationHandler` and
// `PropertyHandlerContext` / `DeclarationContext` now compile for real so the
// `rules/` leaf modules can un-gate against them. The heavy method bodies
// (parse / to_css / minify / get_*_rules) and the per-property handler
// fields stay internally `#[cfg(any())]`-gated until `properties/*` and the
// `rule_parsers` block in css_parser.rs un-gate.
#[path = "context.rs"]
pub mod context;
#[path = "declaration.rs"]
pub mod declaration;

// Crate-root re-exports so `bun_css::DeclarationBlock` etc. resolve for the
// rule modules without going through the (still-shimmed) css_parser hub.
pub use context::{DeclarationContext, PropertyHandlerContext, SupportsEntry};
pub use declaration::{DeclarationBlock, DeclarationHandler, DeclarationList};

// Path aliases the ported submodules expect at crate root (Zig's `css.*`
// namespace was flat; the Rust port re-nests under `values/`/`properties/`
// but most callers still spell `bun_css::css_values::...`).
pub use values as css_values;
pub use properties as css_properties;
pub use rules as css_rules;
pub use selectors::selector;

// Crate-root re-exports of parser-core helpers referenced by the rule/
// selector/property/media_query bodies via `css::*`.
pub use css_parser::{
    enum_property_util, parse_utility, signfns, void_wrap, CssResult as Result,
    Delimiters, EnumProperty, Maybe, ParserState,
};
pub use compat::Feature;
pub use error::ParserErrorKind as ErrorKind;

// `css::generic::*` is the Zig-spelled namespace for the protocol traits +
// reflection helpers. The Rust module is `generics`; alias both spellings so
// value/property modules can use `crate::generic::partial_cmp_f32` etc.
pub use generics as generic;
pub use generics::{implement_deep_clone, implement_eql, implement_hash};
// Serializer + dtoa helpers live in the parser hub but are referenced as
// `css::serializer` / `css::f32_length_with_5_digits` from value modules.
pub use css_parser::{dtoa_short, f32_length_with_5_digits, serializer, to_css};

// generics: un-gated (B-2). Core protocol traits (DeepClone/CssEql/CssHash/
// IsCompatible/ListContainer) compile; Parse/ToCss/Angle impls remain
// internally gated until css_parser/values un-gate.
#[path = "generics.rs"]
pub mod generics;

// ─── B-2 round 2: parser core un-gated ────────────────────────────────────
// `css_parser.rs` now compiles for real: Parser / ParserInput / Tokenizer /
// Token / Delimiters / VendorPrefix / SourceLocation / serializer / nth /
// color / dtoa_short. The rule-orchestration layer (AtRulePrelude,
// TopLevelRuleParser, NestedRuleParser, StyleSheet, StyleAttribute) stays
// internally `#[cfg(any())]`-gated until rules/ + properties/ + selectors/
// un-gate. `printer.rs` is real (Printer struct + write/indent/delim).
// `values/` is real for the leaf submodules; the heavy ones (color, calc,
// gradient, image, length, syntax) are internally gated inside values/mod.rs.
#[path = "printer.rs"]
pub mod printer;
#[path = "css_parser.rs"]
pub mod css_parser;
#[path = "values/mod.rs"]
pub mod values;

/// Data-only value-type stubs re-exported through `values::{color,ident,url}`
/// while the real `values/*.rs` files stay gated on the calc lattice. These
/// were the previous `gated_mod!(values, ...)` body — now a real module so
/// printer.rs / css_parser.rs can name the types.
pub mod values_stub {
    /// Minimal real defs hoisted from `values/color.rs` (gated). Data-only:
    /// the conversion / parse / to_css impls live in the gated file and
    /// supersede these when un-gated. Field layout matches `color.zig`.
    pub mod color {
        /// A color with red, green, blue, and alpha components, in a byte each.
        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        pub struct RGBA {
            pub red: u8,
            pub green: u8,
            pub blue: u8,
            pub alpha: u8,
        }

        macro_rules! colorspace {
            ($name:ident { $($f:ident),* $(,)? }) => {
                #[derive(Debug, Clone, Copy, PartialEq)]
                pub struct $name { $(pub $f: f32,)* pub alpha: f32 }
            };
        }
        // CIE Lab — l/a/b/alpha (color.zig:1622)
        colorspace!(LAB { l, a, b });
        // sRGB — r/g/b/alpha (color.zig:1670)
        colorspace!(SRGB { r, g, b });
        // hsl() — h/s/l/alpha (color.zig:1728)
        colorspace!(HSL { h, s, l });
        // hwb() — h/w/b/alpha (color.zig:1790)
        colorspace!(HWB { h, w, b });
        // sRGB-linear (color.zig:1847)
        colorspace!(SRGBLinear { r, g, b });
        // display-p3 (color.zig:1895)
        colorspace!(P3 { r, g, b });
        // a98-rgb (color.zig:1933)
        colorspace!(A98 { r, g, b });
        // prophoto-rgb (color.zig:1971)
        colorspace!(ProPhoto { r, g, b });
        // rec2020 (color.zig:2009)
        colorspace!(Rec2020 { r, g, b });
        // xyz-d50 (color.zig:2047)
        colorspace!(XYZd50 { x, y, z });
        // xyz-d65 (color.zig:2092)
        colorspace!(XYZd65 { x, y, z });
        // lch() (color.zig:2140)
        colorspace!(LCH { l, c, h });
        // oklab() (color.zig:2188)
        colorspace!(OKLAB { l, a, b });
        // oklch() (color.zig:2236)
        colorspace!(OKLCH { l, c, h });

        /// A color in a LAB color space (`lab()`/`lch()`/`oklab()`/`oklch()`).
        #[derive(Debug, Clone, Copy, PartialEq)]
        pub enum LABColor {
            Lab(LAB),
            Lch(LCH),
            Oklab(OKLAB),
            Oklch(OKLCH),
        }
        /// Dependent crates spell this `LabColor`; alias both ways.
        pub type LabColor = LABColor;

        /// A color in a predefined color space, e.g. `display-p3`.
        #[derive(Debug, Clone, Copy, PartialEq)]
        pub enum PredefinedColor {
            Srgb(SRGB),
            SrgbLinear(SRGBLinear),
            DisplayP3(P3),
            A98(A98),
            Prophoto(ProPhoto),
            Rec2020(Rec2020),
            XyzD50(XYZd50),
            XyzD65(XYZd65),
        }

        /// Floating-point RGB/HSL/HWB used when a color carries `none` components.
        #[derive(Debug, Clone, Copy, PartialEq)]
        pub enum FloatColor {
            Rgb(SRGB),
            Hsl(HSL),
            Hwb(HWB),
        }

        /// CSS system-color keyword. Stub: real variant set lives in
        /// `values/color.rs` (47 keywords) and re-widens on un-gate.
        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        #[non_exhaustive]
        pub enum SystemColor {}

        /// A CSS `<color>` value. Layout matches `values/color.rs::CssColor`.
        #[derive(Debug)]
        pub enum CssColor {
            CurrentColor,
            Rgba(RGBA),
            Lab(Box<LABColor>),
            Predefined(Box<PredefinedColor>),
            Float(Box<FloatColor>),
            LightDark { light: Box<CssColor>, dark: Box<CssColor> },
            System(SystemColor),
        }

        // ───── conversion impls hoisted from `values/color.rs` (gated) ─────
        // Real math for the cheap byte↔float paths; the multi-hop colorspace
        // chains (LAB→XYZd50→XYZd65→SRGBLinear→SRGB) stay `todo!()` until the
        // full `values/color.rs` un-gates with its matrix tables.

        impl RGBA {
            #[inline] pub fn red_f32(&self)   -> f32 { self.red   as f32 / 255.0 }
            #[inline] pub fn green_f32(&self) -> f32 { self.green as f32 / 255.0 }
            #[inline] pub fn blue_f32(&self)  -> f32 { self.blue  as f32 / 255.0 }
            /// Returns the alpha channel in floating point form, 0..1.
            #[inline] pub fn alpha_f32(&self) -> f32 { self.alpha as f32 / 255.0 }

            #[inline]
            pub fn from_floats(red: f32, green: f32, blue: f32, alpha: f32) -> RGBA {
                RGBA {
                    red:   clamp_unit_f32(red),
                    green: clamp_unit_f32(green),
                    blue:  clamp_unit_f32(blue),
                    alpha: clamp_unit_f32(alpha),
                }
            }

            #[inline]
            pub fn into_srgb(&self) -> SRGB {
                SRGB { r: self.red_f32(), g: self.green_f32(), b: self.blue_f32(), alpha: self.alpha_f32() }
            }
        }

        impl SRGB {
            /// `none` components are NaN; resolve them to 0 before quantizing.
            #[inline]
            fn resolve_missing(&self) -> SRGB {
                #[inline] fn nz(v: f32) -> f32 { if v.is_nan() { 0.0 } else { v } }
                SRGB { r: nz(self.r), g: nz(self.g), b: nz(self.b), alpha: nz(self.alpha) }
            }
            /// BoundedColorGamut::inGamut — each channel within [0, 1].
            #[inline]
            fn in_gamut(&self) -> bool {
                (0.0..=1.0).contains(&self.r)
                    && (0.0..=1.0).contains(&self.g)
                    && (0.0..=1.0).contains(&self.b)
            }
            #[inline]
            pub fn into_rgba(&self) -> RGBA {
                let rgb = self.resolve_missing();
                if !rgb.in_gamut() {
                    // Zig's `resolve()` calls `mapGamut()` here (perceptual gamut-map via
                    // OKLCH), which lives in the gated `values/color.rs` matrix tables.
                    // Hard-clamping via `clamp_unit_f32` would silently diverge from Zig.
                    todo!("bun_css::values::color::SRGB mapGamut — gated on values/color.rs un-gate")
                }
                RGBA::from_floats(rgb.r, rgb.g, rgb.b, rgb.alpha)
            }
        }

        impl HSL {
            #[inline]
            fn resolve_missing(&self) -> HSL {
                #[inline] fn nz(v: f32) -> f32 { if v.is_nan() { 0.0 } else { v } }
                HSL { h: nz(self.h), s: nz(self.s), l: nz(self.l), alpha: nz(self.alpha) }
            }
            /// https://drafts.csswg.org/css-color/#hsl-to-rgb
            pub fn into_srgb(&self) -> SRGB {
                let hsl = self.resolve_missing();
                let h = (hsl.h - 360.0 * (hsl.h / 360.0).floor()) / 360.0;
                let (r, g, b) = hsl_to_rgb(h, hsl.s, hsl.l);
                SRGB { r, g, b, alpha: hsl.alpha }
            }
        }

        impl HWB {
            #[inline]
            fn resolve_missing(&self) -> HWB {
                #[inline] fn nz(v: f32) -> f32 { if v.is_nan() { 0.0 } else { v } }
                HWB { h: nz(self.h), w: nz(self.w), b: nz(self.b), alpha: nz(self.alpha) }
            }
            /// https://drafts.csswg.org/css-color/#hwb-to-rgb
            pub fn into_srgb(&self) -> SRGB {
                let hwb = self.resolve_missing();
                if hwb.w + hwb.b >= 1.0 {
                    let gray = hwb.w / (hwb.w + hwb.b);
                    return SRGB { r: gray, g: gray, b: gray, alpha: hwb.alpha };
                }
                let mut rgba = HSL { h: hwb.h, s: 1.0, l: 0.5, alpha: hwb.alpha }.into_srgb();
                let x = 1.0 - hwb.w - hwb.b;
                rgba.r = rgba.r * x + hwb.w;
                rgba.g = rgba.g * x + hwb.w;
                rgba.b = rgba.b * x + hwb.w;
                rgba
            }
        }

        impl FloatColor {
            /// Project any float-color variant into sRGB.
            #[inline]
            pub fn into_srgb(&self) -> SRGB {
                match self {
                    FloatColor::Rgb(c) => *c,
                    FloatColor::Hsl(c) => c.into_srgb(),
                    FloatColor::Hwb(c) => c.into_srgb(),
                }
            }
        }

        impl LABColor {
            /// Project a LAB-space color into sRGB. The full chain
            /// (LAB/LCH/OKLAB/OKLCH → XYZd50 → XYZd65 → sRGB-linear → sRGB)
            /// lives in the gated `values/color.rs` matrix tables; this stub
            /// keeps the surface available and panics if reached at runtime.
            pub fn into_srgb(&self) -> SRGB {
                let _ = self;
                todo!("bun_css::values::color::LABColor::into_srgb — gated on values/color.rs un-gate")
            }
        }

        impl CssColor {
            /// Parse a CSS `<color>` from the parser cursor. Behavior body lives
            /// in the gated `values/color.rs::CssColor::parse`.
            pub fn parse(input: &mut crate::css_parser::Parser<'_>) -> CssColorParseResult {
                let _ = input;
                todo!("bun_css::CssColor::parse — gated on css_parser/values un-gate")
            }
            /// Serialize this color to CSS text via `dest`.
            pub fn to_css(&self, dest: &mut crate::printer::Printer<'_>) -> Result<(), crate::PrintErr> {
                let _ = (self, dest);
                todo!("bun_css::CssColor::to_css — gated on printer/values un-gate")
            }
        }

        #[inline]
        fn clamp_unit_f32(val: f32) -> u8 {
            // Scale by 255, round, clamp. Mirrors `values/color.rs::clamp_unit_f32`.
            (val * 255.0).round().clamp(0.0, 255.0) as u8
        }

        /// https://drafts.csswg.org/css-color/#hsl-to-rgb (`hue` is 0..1 here).
        pub fn hsl_to_rgb(hue: f32, saturation: f32, lightness: f32) -> (f32, f32, f32) {
            #[inline]
            fn hue_to_rgb(m1: f32, m2: f32, mut h3: f32) -> f32 {
                if h3 < 0.0 { h3 += 1.0; }
                if h3 > 1.0 { h3 -= 1.0; }
                if h3 * 6.0 < 1.0 { return m1 + (m2 - m1) * h3 * 6.0; }
                if h3 * 2.0 < 1.0 { return m2; }
                if h3 * 3.0 < 2.0 { return m1 + (m2 - m1) * (2.0 / 3.0 - h3) * 6.0; }
                m1
            }
            let m2 = if lightness <= 0.5 {
                lightness * (saturation + 1.0)
            } else {
                lightness + saturation - lightness * saturation
            };
            let m1 = lightness * 2.0 - m2;
            (
                hue_to_rgb(m1, m2, hue + 1.0 / 3.0),
                hue_to_rgb(m1, m2, hue),
                hue_to_rgb(m1, m2, hue - 1.0 / 3.0),
            )
        }

        /// `Result(CssColor)` — Zig: `pub const ParseResult = Result(CssColor);`
        /// where `Result(T) = Maybe(T, ParseError(ParserError))` (css_parser.zig:278).
        /// Spelled as a concrete enum here (not a `type` alias) so dependents can
        /// pattern-match `.Result(_)` / `.Err(_)` without the gated `Maybe<T,E>` hub.
        pub enum CssColorParseResult {
            Result(CssColor),
            Err(crate::error::ParseError<crate::error::ParserError>),
        }
    }

    /// Data-only stubs of `values/ident.rs::{Ident,DashedIdent,CustomIdent}` so
    /// `generics::ident_eql` and cross-crate name lookups compile. Behavior
    /// (`parse`/`to_css`) lives in the gated file. Field layout matches
    /// `ident.zig` (single arena-borrowed slice).
    pub mod ident {
        // TODO(port): arena lifetime — `v` borrows the parser arena; Phase B
        // threads `'bump` once the bumpalo arena lifetime is plumbed.
        macro_rules! ident_newtype {
            ($name:ident) => {
                #[derive(Debug, Clone, Copy)]
                pub struct $name {
                    pub v: *const [u8],
                }
                impl $name {
                    /// Borrow the underlying arena slice.
                    /// SAFETY: caller must ensure the parser arena outlives the borrow.
                    #[inline]
                    pub unsafe fn as_slice(&self) -> &[u8] {
                        // SAFETY: upheld by caller per fn-level contract.
                        unsafe { &*self.v }
                    }
                }
            };
        }
        ident_newtype!(Ident);
        ident_newtype!(DashedIdent);
        ident_newtype!(CustomIdent);

        /// Zig: `pub const CustomIdentList = SmallList(CustomIdent, 1);`
        pub type CustomIdentList = crate::SmallList<CustomIdent, 1>;

        /// Either a literal identifier or a reference into the symbol table
        /// (CSS-modules local name). Data-only stub of `values/ident.rs::
        /// IdentOrRef` — kept as a tagged enum mirroring the spec's
        /// `packed struct(u128)` discriminated union (ident.zig:148-265) so
        /// it never stores both an Ident and a Ref simultaneously.
        ///
        /// NOTE: the real packed-u128 implementation lives in
        /// `crate::values::ident::IdentOrRef` (now un-gated); this stub is
        /// retained only for any remaining `values_stub` consumers.
        #[derive(Clone, Copy)]
        pub enum IdentOrRef {
            Ident(Ident),
            Ref(bun_logger::Ref),
        }
        impl IdentOrRef {
            #[inline] pub fn from_ident(ident: Ident) -> Self { IdentOrRef::Ident(ident) }
            #[inline] pub fn from_ref(r: bun_logger::Ref) -> Self { IdentOrRef::Ref(r) }
            #[inline] pub fn is_ident(&self) -> bool { matches!(self, IdentOrRef::Ident(_)) }
            #[inline] pub fn as_ident(&self) -> Option<Ident> {
                match *self { IdentOrRef::Ident(i) => Some(i), _ => None }
            }
            #[inline] pub fn as_ref(&self) -> Option<bun_logger::Ref> {
                match *self { IdentOrRef::Ref(r) => Some(r), _ => None }
            }
            /// Returns the underlying ident bytes for debugging (matches
            /// ident.zig:160-171). For the `Ref` arm there is no ident slice
            /// in this stub, so a sentinel is returned.
            #[inline] pub fn debug_ident(&self) -> &[u8] {
                match self {
                    // SAFETY: `v` borrows the parser arena; caller (Printer
                    // debug path) is scoped within the parse session.
                    IdentOrRef::Ident(i) => unsafe { i.as_slice() },
                    IdentOrRef::Ref(_) => b"<ref>",
                }
            }
        }
    }

    /// Data-only stub of `values/url.rs::Url` so `dependencies::UrlDependency::new`
    /// can compile. Behavior (`parse`/`is_absolute`/`to_css`) lives in the gated
    /// file. Field layout matches `url.zig`.
    pub mod url {
        pub struct Url {
            /// The url string.
            pub import_record_idx: u32,
            /// The location where the `url()` was seen in the CSS source file.
            pub loc: crate::dependencies::Location,
        }
    }
}


// ─── stub re-exports referenced cross-crate ────────────────────────────────
// TODO(b1): real types come back when modules are un-gated in B-2.
pub type CustomMedia = ();

/// Hoisted from `css_parser.rs` (gated). Single-variant error type returned by
/// every `to_css` path; the *kind* lives in `Printer.error_kind` (PrinterError)
/// — this is just the bubbled signal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrintErr {
    CSSPrintError,
}
impl PrintErr {
    #[inline]
    pub fn name(&self) -> &'static str {
        "CSSPrintError"
    }
}
impl core::fmt::Display for PrintErr {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("CSS print error")
    }
}
impl core::error::Error for PrintErr {}
pub use dependencies::Dependency;

// B-2 Track A surface: re-export the stubbed hub types at the crate root so
// `bun_css::Foo` paths resolve for css_jsc / bundler.
pub use css_parser::{
    DefaultAtRule, LocalsResultsMap, MinifyOptions, Parser, ParserFlags, ParserInput,
    ParserOptions, SrcIndex, StyleAttribute, StyleSheet, StylesheetExtra, ToCssResult,
};
pub use printer::{ImportInfo, Printer, PrinterOptions, PseudoClasses};
/// Dependent crates name this `ImportRecordHandler` (Zig had a now-removed
/// union of the same name in css_parser.zig:3783); the surviving type is
/// `printer::ImportInfo`, exposed under both names.
pub type ImportRecordHandler<'a> = printer::ImportInfo<'a>;
pub use values::color::{
    CssColor, FloatColor, LABColor, LabColor, PredefinedColor, RGBA,
};
pub use values_stub::color::CssColorParseResult;

// Real re-exports from un-gated modules (cross-crate surface).
pub use error::{
    BasicParseError, BasicParseErrorKind, Err, ErrorLocation, MinifyError, MinifyErrorKind,
    ParseError, ParserError, ParserErrorKind, PrinterError, PrinterErrorKind, SelectorError,
};
pub type Error = Err<ParserError>;
pub use targets::{Browsers, Features, Targets};
pub use logical::{LogicalGroup, PropertyCategory};

// ───────────────────────────── VendorPrefix ─────────────────────────────
// Hoisted from css_parser.rs so leaf modules (targets, prefixes) can compile
// without pulling in the 6k-line parser hub. css_parser.rs re-exports this
// when it un-gates.

bitflags::bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
    pub struct VendorPrefix: u8 {
        /// No vendor prefixes. 0b00000001
        const NONE   = 0b0000_0001;
        /// The `-webkit` vendor prefix. 0b00000010
        const WEBKIT = 0b0000_0010;
        /// The `-moz` vendor prefix. 0b00000100
        const MOZ    = 0b0000_0100;
        /// The `-ms` vendor prefix. 0b00001000
        const MS     = 0b0000_1000;
        /// The `-o` vendor prefix. 0b00010000
        const O      = 0b0001_0000;
    }
}

impl VendorPrefix {
    pub const EMPTY: VendorPrefix = VendorPrefix::empty();
    pub const ALL_PREFIXES: VendorPrefix = VendorPrefix::all();

    /// Fields listed here so we can iterate them in the order we want
    pub const FIELDS: &'static [&'static str] = &["webkit", "moz", "ms", "o", "none"];

    // NOTE: bitflags 2.x already generates `from_name(&str) -> Option<Self>`;
    // the Zig `fromName` (panicking) is exposed as `from_name_str`.
    #[inline]
    pub fn from_name_str(name: &str) -> VendorPrefix {
        match name {
            "none" => VendorPrefix::NONE,
            "webkit" => VendorPrefix::WEBKIT,
            "moz" => VendorPrefix::MOZ,
            "ms" => VendorPrefix::MS,
            "o" => VendorPrefix::O,
            _ => unreachable!(),
        }
    }

    /// Returns VendorPrefix::None if empty.
    #[inline]
    pub fn or_none(self) -> VendorPrefix {
        self.or_(VendorPrefix::NONE)
    }

    /// **WARNING**: NOT THE SAME as bitwise-or!!
    #[inline]
    pub fn or_(self, other: VendorPrefix) -> VendorPrefix {
        if self.is_empty() { other } else { self }
    }

    pub fn difference_(left: Self, right: Self) -> Self {
        // Zig used arithmetic subtraction on bits; preserve that.
        Self::from_bits_retain(left.bits().wrapping_sub(right.bits()))
    }

    pub fn bitwise_and(a: Self, b: Self) -> Self {
        a & b
    }

    pub fn as_bits(self) -> u8 {
        self.bits()
    }
}

// ───────────────────────── Core lexer/location types ─────────────────────────
// Hoisted from css_parser.rs / rules/mod.rs so leaf modules (error, dependencies)
// compile without the 6k-line parser hub. css_parser.rs `pub use crate::{..}`s
// these when it un-gates.

/// Line/column within a single source. Column is 1-based, line is 0-based.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct SourceLocation {
    pub line: u32,
    pub column: u32,
}

/// Cross-source location (carries a source-map source index).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
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

#[derive(Clone, Copy, Debug)]
pub struct Num {
    pub has_sign: bool,
    pub value: f32,
    pub int_value: Option<i32>,
}

#[derive(Clone, Debug)]
pub struct Dimension {
    pub num: Num,
    /// e.g. "px"
    // TODO(port): arena lifetime — &'static placeholder per PORTING.md §AST crates.
    pub unit: &'static [u8],
}

/// CSS lexer token. Data-only definition hoisted out of `css_parser.rs`; the
/// `to_css*`/`eql`/`hash` impls stay in `css_parser.rs` (gated) since they
/// depend on `serializer::*` and `generics`.
// TODO(port): every &'static [u8] payload borrows the parser arena/source;
// Phase B threads `<'a>` once the bumpalo arena lifetime is plumbed.
#[derive(Clone, Debug)]
pub enum Token {
    Ident(&'static [u8]),
    Function(&'static [u8]),
    AtKeyword(&'static [u8]),
    UnrestrictedHash(&'static [u8]),
    IdHash(&'static [u8]),
    QuotedString(&'static [u8]),
    BadString(&'static [u8]),
    UnquotedUrl(&'static [u8]),
    BadUrl(&'static [u8]),
    /// A `<delim-token>` — single codepoint. In practice always ASCII.
    Delim(u32),
    Number(Num),
    Percentage { has_sign: bool, unit_value: f32, int_value: Option<i32> },
    Dimension(Dimension),
    Whitespace(&'static [u8]),
    /// `<!--`
    Cdo,
    /// `-->`
    Cdc,
    IncludeMatch,
    DashMatch,
    PrefixMatch,
    SuffixMatch,
    SubstringMatch,
    Colon,
    Semicolon,
    Comma,
    OpenSquare,
    CloseSquare,
    OpenParen,
    CloseParen,
    OpenCurly,
    CloseCurly,
    /// Not an actual token in the spec, but we keep it anyway
    Comment(&'static [u8]),
}

impl core::fmt::Display for Token {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // B-2: minimal rendering for error messages. The full Zig
        // `Token.format` (CSS serialization) lives in `css_parser.rs` and
        // depends on `serializer::*`; that impl supersedes this when un-gated.
        use bstr::BStr;
        match self {
            Token::Ident(v) | Token::Function(v) | Token::AtKeyword(v)
            | Token::UnrestrictedHash(v) | Token::IdHash(v) | Token::QuotedString(v)
            | Token::BadString(v) | Token::UnquotedUrl(v) | Token::BadUrl(v)
            | Token::Whitespace(v) | Token::Comment(v) => {
                write!(f, "{}", BStr::new(v))
            }
            Token::Delim(c) => write!(f, "{}", char::from_u32(*c).unwrap_or('\u{FFFD}')),
            Token::Number(n) => write!(f, "{}", n.value),
            Token::Percentage { unit_value, .. } => write!(f, "{}%", *unit_value * 100.0),
            Token::Dimension(d) => write!(f, "{}{}", d.num.value, BStr::new(d.unit)),
            Token::Cdo => f.write_str("<!--"),
            Token::Cdc => f.write_str("-->"),
            Token::IncludeMatch => f.write_str("~="),
            Token::DashMatch => f.write_str("|="),
            Token::PrefixMatch => f.write_str("^="),
            Token::SuffixMatch => f.write_str("$="),
            Token::SubstringMatch => f.write_str("*="),
            Token::Colon => f.write_str(":"),
            Token::Semicolon => f.write_str(";"),
            Token::Comma => f.write_str(","),
            Token::OpenSquare => f.write_str("["),
            Token::CloseSquare => f.write_str("]"),
            Token::OpenParen => f.write_str("("),
            Token::CloseParen => f.write_str(")"),
            Token::OpenCurly => f.write_str("{"),
            Token::CloseCurly => f.write_str("}"),
        }
    }
}
