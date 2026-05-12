#![feature(allocator_api)]
#![allow(
    unused,
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    clippy::all
)]
#![warn(unused_must_use)]
// Allow `use bun_css as css;` from inside the crate — the ported submodules
// were translated against the crate's public surface and refer to it by name.
extern crate self as bun_css;

/// Case-insensitive ASCII byte-slice dispatch — the fix for Zig's
/// `css.todo_stuff.match_ignore_ascii_case` sentinel and a drop-in port of
/// rust-cssparser's `match_ignore_ascii_case!`.
///
/// Expands to an `if / else if / else` chain over
/// [`bun_core::strings::eql_case_insensitive_ascii_check_length`] (length-checked,
/// ASCII-fold only, byte-wise — identical to Zig's
/// `bun.strings.eqlCaseInsensitiveASCIIICheckLength`). The whole macro is an
/// expression; arms may `return`, `break 'label`, or yield a value.
///
/// Supports `|`-alternation and Rust-style `if` guards on arms; the trailing
/// `_ =>` fallback is mandatory.
///
/// ```ignore
/// crate::match_ignore_ascii_case! { unit, {
///     b"deg"                       => Ok(Angle::Deg(value)),
///     b"dppx" | b"x"               => Ok(Resolution::Dppx(value)),
///     b"local" if mods.is_some()   => PseudoClass::Local { .. },
///     _                            => Err(location.new_unexpected_token_error(token)),
/// }}
/// ```
// TODO(port): swap body to phf when CI hasher lands.
#[macro_export]
macro_rules! match_ignore_ascii_case {
    ($name:expr, { $( $($lit:literal)|+ $(if $guard:expr)? => $arm:expr ,)* _ => $fallback:expr $(,)? }) => {{
        let __n: &[u8] = $name;
        $( if ($( ::bun_core::strings::eql_case_insensitive_ascii_check_length(__n, $lit) )||+) $(&& ($guard))? { $arm } else )* { $fallback }
    }};
}

// AUTOGEN: mod declarations only — real exports added in B-1.
//
// B-2 un-gating in progress: leaf modules compile for real; the heavily
// inter-dependent hub modules (css_parser, properties/, rules/, values/,
// selectors/, declaration, generics, media_query, printer, context,
// css_modules, small_list, dependencies, error) remain gated behind
// `` until the cross-module re-export web is untangled in a
// follow-up B-2 round.

// ─── B-2 un-gated modules ─────────────────────────────────────────────────
#[path = "compat.rs"]
pub mod compat;
#[path = "logical.rs"]
pub mod logical;
#[path = "prefixes.rs"]
pub mod prefixes;
#[path = "sourcemap.rs"]
pub mod sourcemap;
#[path = "targets.rs"]
pub mod targets;

#[path = "css_modules.rs"]
pub mod css_modules;
#[path = "dependencies.rs"]
pub mod dependencies;
#[path = "error.rs"]
pub mod error;
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
#[path = "media_query.rs"]
pub mod media_query;
#[path = "properties/mod.rs"]
pub mod properties;
#[path = "rules/mod.rs"]
pub mod rules;
#[path = "selectors/mod.rs"]
pub mod selectors;

// ─── B-2 round 4: declaration/context un-gated ────────────────────────────
// `DeclarationBlock` / `DeclarationList` / `DeclarationHandler` and
// `PropertyHandlerContext` / `DeclarationContext` now compile for real so the
// `rules/` leaf modules can un-gate against them. The heavy method bodies
// (parse / to_css / minify / get_*_rules) and the per-property handler
// fields stay internally ``-gated until `properties/*` un-gate.
// The `RuleBodyParser`/`RuleBodyItemParser`/`DeclarationParser` traits are
// now un-gated in css_parser.rs (round 5), so `DeclarationBlock::parse` can
// flip when `properties_generated` lands.
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
pub use properties as css_properties;
pub use rules as css_rules;
pub use selectors::selector;
pub use values as css_values;

// Crate-root re-exports of parser-core helpers referenced by the rule/
// selector/property/media_query bodies via `css::*`.
pub use css_parser::{
    CssRef, CssRefTag, CssResult as Result, Delimiters, EnumProperty, IntoParserError, Maybe,
    ParserState, enum_property_util, nth, parse_utility, signfns, void_wrap,
};

// ─── selectors/ crate-root surface ────────────────────────────────────────
// The selector grammar references these via `bun_css::*` (Zig's flat `css.*`
// namespace). `Str` is the arena-borrowed `[]const u8` slice alias; in Phase A
// it's `*const [u8]` (matches `error.rs` / `values::ident` field shape) and
// becomes `&'bump [u8]` once the arena lifetime is plumbed.
pub type Str = *const [u8];

/// Dereference an arena-owned [`Str`] into a slice borrow.
///
/// This is the **single** named entry point for the Phase-A `&*(p: *const [u8])`
/// pattern; every call site shares the same invariant (parser source/arena is
/// immutable for the session and outlives every value constructed from it), so
/// the SAFETY justification lives here once instead of being repeated ~70×.
/// The `'static` return lifetime is the Phase-A placeholder — Phase B threads
/// `'bump`, `Str` becomes `&'bump [u8]`, and this fn is deleted.
///
/// # Safety
/// `p` must be a non-null fat pointer into the parser's source text or bump
/// arena, and that backing storage must outlive the returned reference.
#[inline(always)]
pub unsafe fn arena_str(p: Str) -> &'static [u8] {
    // SAFETY: caller contract (documented above) guarantees `p` is a non-null,
    // well-aligned fat pointer into the parser's immutable source/bump arena,
    // whose backing storage outlives the returned reference.
    unsafe { &*p }
}
pub use compat::Feature;
/// `css::ParseErrorKind` — Zig spelling. Alias of `error::ParserErrorKind`.
pub use error::ParserErrorKind as ParseErrorKind;
pub use error::ParserErrorKind as ErrorKind;
pub use properties::custom::{TokenList, TokenListFns};
pub use values::ident::{CustomIdentFns, DashedIdentFns, IdentFns};
pub use values::string::{CssString as CSSString, CssStringFns as CSSStringFns};

// `css::generic::*` is the Zig-spelled namespace for the protocol traits +
// reflection helpers. The Rust module is `generics`; alias both spellings so
// value/property modules can use `crate::generic::partial_cmp_f32` etc.
pub use generics as generic;
pub use generics::{implement_deep_clone, implement_eql, implement_hash};
// Same-name trait + derive macro re-export so `#[derive(bun_css::DeepClone)]`
// (and `use bun_css::DeepClone;` at leaf sites) brings both into scope.
pub use generics::{CssEql, DeepClone};
// Keyword-enum / `union(enum)` derive macros (port of Zig's `DefineEnumProperty`
// / `DeriveParse` / `DeriveToCss` comptime fns). The `EnumProperty` *trait* is
// re-exported above from `css_parser`; the *derive* of the same name lives in
// the proc-macro crate.
pub use bun_css_derive::{DefineEnumProperty, Parse, ToCss};
// Serializer + dtoa helpers live in the parser hub but are referenced as
// `css::serializer` / `css::f32_length_with_5_digits` from value modules.
pub use css_parser::{dtoa_short, f32_length_with_5_digits, serializer, to_css};

// generics: un-gated (B-2). Core protocol traits (DeepClone/CssEql/CssHash/
// IsCompatible/ListContainer) compile; Parse/ToCss/Angle impls remain
// internally gated until css_parser/values un-gate.
#[path = "generics.rs"]
pub mod generics;

// ─── B-2 round 2/5: parser core + rule-orchestration un-gated ─────────────
// `css_parser.rs` now compiles for real: Parser / ParserInput / Tokenizer /
// Token / Delimiters / VendorPrefix / SourceLocation / serializer / nth /
// color / dtoa_short. Round 5 un-gates the rule-orchestration *type* layer
// (AtRulePrelude, TopLevelRuleParser, NestedRuleParser, StyleSheetParser,
// RuleBodyParser, StyleSheet, StyleAttribute, DeclarationParser/
// RuleBodyItemParser/ComposesCtx traits) against the now-real `rules/`/
// `selectors/`/`declaration`/`media_query` hubs. The heavy *behavior* bodies
// (`AtRuleParser`/`QualifiedRuleParser` impls for Top/NestedRuleParser,
// `StyleSheet::{parse,minify,to_css}`, `StyleAttribute::{parse,to_css}`)
// stay internally ``-gated on the rules/ leaf modules +
// properties_generated. `printer.rs` is real (Printer struct +
// write/indent/delim). `values/` is real for the leaf submodules; the heavy
// ones (color, calc, gradient, image, length, syntax) are internally gated
// inside values/mod.rs.
#[path = "css_parser.rs"]
pub mod css_parser;
#[path = "printer.rs"]
pub mod printer;
#[path = "values/mod.rs"]
pub mod values;

/// Data-only value-type stubs re-exported through `values::{color,ident,url}`
/// while the real `values/*.rs` files stay gated on the calc lattice. These
/// were the previous `gated_mod!(values, ...)` body — now a real module so
/// printer.rs / css_parser.rs can name the types.
pub mod values_stub {
    /// `values/color.rs` is now un-gated (B-2 round 6); re-export the real
    /// data + behavior surface so any remaining `values_stub::color::*` paths
    /// resolve to the canonical types. The previous data-only stub structs and
    /// placeholder `into_rgba`/`into_srgb`/`parse`/`to_css` impls are
    /// superseded by the real bodies in `crate::values::color`.
    pub mod color {
        pub use crate::values::color::*;

        /// `Result(CssColor)` — Zig: `pub const ParseResult = Result(CssColor);`
        /// where `Result(T) = Maybe(T, ParseError(ParserError))` (css_parser.zig:278).
        /// `Maybe` is now un-gated as `core::result::Result`, so this is a
        /// straight type alias to the real `values::color::ParseResult`.
        pub type CssColorParseResult = crate::values::color::ParseResult;

        /// https://drafts.csswg.org/css-color/#hsl-to-rgb (`hue` is 0..1 here).
        /// Real body lives in `css_parser::color::hsl_to_rgb`; re-exported for
        /// any callers that reached it via the stub path.
        pub use crate::css_parser::color::hsl_to_rgb;
    }

    /// Re-export of the real `values/ident.rs` — the data-only stub that used
    /// to live here (so `generics::ident_eql` could compile) is obsolete:
    /// `values::ident` is un-gated and `generics.rs` imports it directly.
    /// The stub `IdentOrRef` had diverged (tagged enum vs packed-u128), so
    /// this also removes a latent type-confusion hazard.
    pub mod ident {
        pub use crate::values::ident::*;
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

/// `PrintErr!T` return shape (Zig: `PrintErr!void`) used by every `to_css`
/// path. Distinct from `css_parser::PrintResult<T> = Maybe<T, PrinterError>`,
/// which carries the rich `Err<PrinterErrorKind>` — this is just the bubbled
/// signal (the *kind* lives in `Printer.error_kind`).
pub type PrintResult<T = ()> = core::result::Result<T, PrintErr>;

pub use dependencies::Dependency;

// B-2 Track A surface: re-export the stubbed hub types at the crate root so
// `bun_css::Foo` paths resolve for css_jsc / bundler.
pub use css_parser::{
    DefaultAtRule, LocalsResultsMap, MinifyOptions, Parser, ParserFlags, ParserInput,
    ParserOptions, StyleAttribute, StyleSheet, StylesheetExtra, ToCssResult,
};
pub use printer::{ImportInfo, Printer, PrinterOptions, PseudoClasses};
/// Dependent crates name this `ImportRecordHandler` (Zig had a now-removed
/// union of the same name in css_parser.zig:3783); the surviving type is
/// `printer::ImportInfo`, exposed under both names.
pub type ImportRecordHandler<'a> = printer::ImportInfo<'a>;
pub use values::color::{CssColor, FloatColor, LABColor, LabColor, PredefinedColor, RGBA};
pub use values_stub::color::CssColorParseResult;

// Real re-exports from un-gated modules (cross-crate surface).
pub use error::{
    BasicParseError, BasicParseErrorKind, Err, ErrorLocation, MinifyError, MinifyErrorKind,
    ParseError, ParserError, ParserErrorKind, PrinterError, PrinterErrorKind, SelectorError,
};
pub type Error = Err<ParserError>;
pub use logical::{LogicalGroup, PropertyCategory};
pub use targets::{Browsers, Features, Targets};

// Bundler-facing surface (`bun_bundler::Chunk` / `scanImportsAndExports`
// reach for these via `bun_css::*`).
pub use css_parser::BundlerStyleSheet;
pub use properties::PropertyIdTag;
pub use rules::import::ImportConditions;

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
    pub const FIELDS: &'static [VendorPrefix] = &[
        VendorPrefix::WEBKIT,
        VendorPrefix::MOZ,
        VendorPrefix::MS,
        VendorPrefix::O,
        VendorPrefix::NONE,
    ];

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

    pub fn bitwise_and(self, b: Self) -> Self {
        self & b
    }

    pub fn as_bits(self) -> u8 {
        self.bits()
    }

    /// Detects a leading vendor prefix on `name` (case-insensitive, ASCII) and
    /// returns it together with the slice that follows the prefix.
    ///
    /// Returns `(VendorPrefix::NONE, name)` when no prefix matches. Prefix forms
    /// are the canonical dash-terminated spellings (`-webkit-`, `-moz-`, `-o-`,
    /// `-ms-`); callers that previously matched without the trailing dash were
    /// only correct because their input domain was already constrained.
    #[inline]
    pub fn strip_from(name: &[u8]) -> (VendorPrefix, &[u8]) {
        use bun_core::strings::starts_with_case_insensitive_ascii as has;
        if has(name, b"-webkit-") {
            (VendorPrefix::WEBKIT, &name[8..])
        } else if has(name, b"-moz-") {
            (VendorPrefix::MOZ, &name[5..])
        } else if has(name, b"-o-") {
            (VendorPrefix::O, &name[3..])
        } else if has(name, b"-ms-") {
            (VendorPrefix::MS, &name[4..])
        } else {
            (VendorPrefix::NONE, name)
        }
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
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, DeepClone)]
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
        Location {
            source_index: u32::MAX,
            line: u32::MAX,
            column: u32::MAX,
        }
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
    Percentage {
        has_sign: bool,
        unit_value: f32,
        int_value: Option<i32>,
    },
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
            | Token::Comment(v) => {
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
