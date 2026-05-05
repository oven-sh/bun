#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
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

// ─── still gated (heavy cross-module deps) ────────────────────────────────
gated_mod!(properties, "properties/mod.rs");
gated_mod!(rules, "rules/mod.rs");
gated_mod!(selectors, "selectors/selector.rs");
gated_mod!(context, "context.rs");
gated_mod!(declaration, "declaration.rs");
gated_mod!(generics, "generics.rs");
gated_mod!(media_query, "media_query.rs");

// `values`, `printer`, `css_parser` carry stub bodies so cross-crate
// dependents (css_jsc, bundler) can name the public surface types while the
// 6k+-line implementation hubs stay gated. Bodies hold *data layout only* —
// behavior (parse/to_css/minify) re-enables when the real module un-gates.
gated_mod!(values, "values/mod.rs", {
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

        /// `Result(CssColor)` — Zig: `pub const ParseResult = Result(CssColor);`
        /// where `Result(T) = Maybe(T, ParseError(ParserError))` (css_parser.zig:278).
        /// Spelled as a concrete enum here (not a `type` alias) so dependents can
        /// pattern-match `.Result(_)` / `.Err(_)` without the gated `Maybe<T,E>` hub.
        pub enum CssColorParseResult {
            Result(CssColor),
            Err(crate::error::ParseError<crate::error::ParserError>),
        }
    }
});

gated_mod!(printer, "printer.rs", {
    use crate::{dependencies, sourcemap, targets::Targets};
    use bun_collections::BabyList;
    use bun_options_types::ImportRecord;

    /// Options that control how CSS is serialized to a string.
    /// Data-only stub of `printer.rs::PrinterOptions`; field layout matches.
    pub struct PrinterOptions<'a> {
        pub minify: bool,
        pub source_map: Option<&'a mut sourcemap::SourceMap>,
        pub project_root: Option<&'a [u8]>,
        pub targets: Targets,
        pub analyze_dependencies: Option<dependencies::DependencyOptions>,
        pub pseudo_classes: Option<PseudoClasses<'a>>,
        pub public_path: &'a [u8],
    }

    impl<'a> Default for PrinterOptions<'a> {
        fn default() -> Self {
            Self {
                minify: false,
                source_map: None,
                project_root: None,
                targets: Targets::default(),
                analyze_dependencies: None,
                pseudo_classes: None,
                public_path: b"",
            }
        }
    }

    /// User-action pseudo-class → class-name mapping.
    #[derive(Default, Clone, Copy)]
    pub struct PseudoClasses<'a> {
        pub hover: Option<&'a [u8]>,
        pub active: Option<&'a [u8]>,
        pub focus: Option<&'a [u8]>,
        pub focus_visible: Option<&'a [u8]>,
        pub focus_within: Option<&'a [u8]>,
    }

    /// Import-record view passed to the printer. Zig: `printer.zig::ImportInfo`.
    pub struct ImportInfo<'a> {
        pub import_records: &'a BabyList<ImportRecord>,
        pub ast_urls_for_css: &'a [&'a [u8]],
        pub ast_unique_key_for_additional_file: &'a [&'a [u8]],
    }

    impl<'a> ImportInfo<'a> {
        /// Only safe outside the bundler (records not resolved to source indices).
        pub fn init_outside_of_bundler(records: &'a BabyList<ImportRecord>) -> ImportInfo<'a> {
            ImportInfo {
                import_records: records,
                ast_urls_for_css: &[],
                ast_unique_key_for_additional_file: &[],
            }
        }
    }

    /// CSS serialization sink. Opaque stub: the real struct (printer.rs:131)
    /// carries a `dyn Write` dest, source-map state, css-module state, etc.
    /// Dependents only name the type (`&mut Printer`) until the hub un-gates.
    #[non_exhaustive]
    pub struct Printer<'a> {
        // keep the lifetime parameter live without committing to layout
        _life: core::marker::PhantomData<&'a ()>,
    }
});

gated_mod!(css_parser, "css_parser.rs", {
    use crate::{css_modules, error, targets};
    use bun_collections::ArrayHashMap;

    /// Zero-sized default custom-at-rule used by `StyleSheet<DefaultAtRule>`
    /// when callers don't extend the at-rule grammar (css_parser.zig:1295).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
    pub struct DefaultAtRule;

    /// Options for `StyleSheet::minify` (css_parser.zig:2898).
    #[derive(Default)]
    pub struct MinifyOptions {
        pub targets: targets::Targets,
        pub unused_symbols: ArrayHashMap<Box<[u8]>, ()>,
    }

    bitflags::bitflags! {
        /// Parser feature flags.
        #[derive(Clone, Copy, PartialEq, Eq, Default)]
        pub struct ParserFlags: u8 {
            const NESTING = 0b001;
            const CUSTOM_MEDIA = 0b010;
            const DEEP_SELECTOR_COMBINATOR = 0b100;
        }
    }

    /// Options to `StyleSheet::parse` / `StyleAttribute::parse`
    /// (css_parser.zig:3683). Data-only stub of `css_parser.rs::ParserOptions`.
    pub struct ParserOptions<'a> {
        pub filename: &'a [u8],
        pub css_modules: Option<css_modules::Config>,
        pub source_index: u32,
        pub error_recovery: bool,
        pub logger: Option<&'a mut bun_logger::Log>,
        pub flags: ParserFlags,
    }

    impl<'a> Default for ParserOptions<'a> {
        fn default() -> Self {
            Self {
                filename: b"",
                css_modules: None,
                source_index: 0,
                error_recovery: false,
                logger: None,
                flags: ParserFlags::default(),
            }
        }
    }

    /// Local-symbol renaming results. Zig: `bun.bundle_v2.MangledProps`
    /// (`ArrayHashMap(Ref, []const u8)`); `Ref` is hoisted in `bun_logger`.
    pub type LocalsResultsMap = ArrayHashMap<bun_logger::Ref, Box<[u8]>>;

    /// Tokenizer + cached lookahead (css_parser.zig:4545). Opaque stub:
    /// field layout depends on `Tokenizer` which is still gated.
    #[non_exhaustive]
    pub struct ParserInput<'a> {
        _life: core::marker::PhantomData<&'a ()>,
    }

    /// CSS parser cursor (css_parser.zig:3804). Opaque stub.
    #[non_exhaustive]
    pub struct Parser<'a> {
        _life: core::marker::PhantomData<&'a ()>,
    }

    /// A parsed stylesheet (css_parser.zig:3045). Opaque stub generic over
    /// the custom-at-rule type so `StyleSheet<DefaultAtRule>` / `BundlerStyleSheet`
    /// type-paths resolve; `parse`/`minify`/`to_css` re-enable on un-gate.
    #[non_exhaustive]
    pub struct StyleSheet<AtRule> {
        _at: core::marker::PhantomData<AtRule>,
    }

    /// A parsed inline `style="…"` attribute (css_parser.zig:3450). Opaque stub.
    #[non_exhaustive]
    pub struct StyleAttribute {
        _p: (),
    }
});

// ─── stub re-exports referenced cross-crate ────────────────────────────────
// TODO(b1): real types come back when modules are un-gated in B-2.
pub type PrintErr = ();
pub type CustomMedia = ();
pub use dependencies::Dependency;

// B-2 Track A surface: re-export the stubbed hub types at the crate root so
// `bun_css::Foo` paths resolve for css_jsc / bundler.
pub use css_parser::{
    DefaultAtRule, LocalsResultsMap, MinifyOptions, Parser, ParserFlags, ParserInput,
    ParserOptions, StyleAttribute, StyleSheet,
};
pub use printer::{ImportInfo, Printer, PrinterOptions, PseudoClasses};
/// Dependent crates name this `ImportRecordHandler` (Zig had a now-removed
/// union of the same name in css_parser.zig:3783); the surviving type is
/// `printer::ImportInfo`, exposed under both names.
pub type ImportRecordHandler<'a> = printer::ImportInfo<'a>;
pub use values::color::{
    CssColor, CssColorParseResult, FloatColor, LABColor, LabColor, PredefinedColor, RGBA,
};

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
        Location { source_index: 0, line: 0, column: 0 }
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
