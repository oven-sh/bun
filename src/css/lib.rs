#![feature(allocator_api)]
#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
// Allow `use bun_css as css;` from inside the crate — the ported submodules
// were translated against the crate's public surface and refer to it by name.
extern crate self as bun_css;

/// Case-insensitive ASCII byte-slice dispatch — equivalent to
/// rust-cssparser's `match_ignore_ascii_case!`.
///
/// Expands to an `if / else if / else` chain over
/// [`bun_core::strings::eql_case_insensitive_ascii_check_length`] (length-checked,
/// ASCII-fold only, byte-wise). The whole macro is an
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
#[macro_export]
macro_rules! match_ignore_ascii_case {
    ($name:expr, { $( $($lit:literal)|+ $(if $guard:expr)? => $arm:expr ,)* _ => $fallback:expr $(,)? }) => {{
        let __n: &[u8] = $name;
        $( if ($( ::bun_core::strings::eql_case_insensitive_ascii_check_length(__n, $lit) )||+) $(&& ($guard))? { $arm } else )* { $fallback }
    }};
}

// ─── leaf modules ─────────────────────────────────────────────────────────
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

#[path = "crate_error.rs"]
pub mod crate_error;
pub use crate_error::{Error as CrateError, Result as CrateResult};
#[path = "css_modules.rs"]
pub mod css_modules;
#[path = "dependencies.rs"]
pub mod dependencies;
#[path = "error.rs"]
pub mod error;
#[path = "small_list.rs"]
pub mod small_list;
pub use small_list::SmallList;

// ─── rule-tree hubs ───────────────────────────────────────────────────────
#[path = "media_query.rs"]
pub mod media_query;
#[path = "properties/mod.rs"]
pub mod properties;
#[path = "rules/mod.rs"]
pub mod rules;
#[path = "selectors/mod.rs"]
pub mod selectors;

// ─── declaration/context ──────────────────────────────────────────────────
#[path = "context.rs"]
pub mod context;
#[path = "declaration.rs"]
pub mod declaration;

// Crate-root re-exports so `bun_css::DeclarationBlock` etc. resolve for the
// rule modules without going through the (still-shimmed) css_parser hub.
pub use context::{DeclarationContext, PropertyHandlerContext, SupportsEntry};
pub use declaration::{DeclarationBlock, DeclarationHandler, DeclarationList};

// Path aliases the submodules expect at crate root (the crate re-nests under
// `values/`/`properties/` but most callers still spell
// `bun_css::css_values::...`).
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
// The selector grammar references these via `bun_css::*`. `Str` is the
// arena-borrowed byte-slice alias; here it's `*const [u8]` (matches
// `error.rs` / `values::ident` field shape) and becomes `&'bump [u8]` once
// the arena lifetime is plumbed.
pub(crate) type Str = *const [u8];

/// Dereference an arena-owned [`Str`] into a slice borrow.
///
/// This is the **single** named entry point for the `&*(p: *const [u8])`
/// pattern; every call site shares the same invariant (parser source/arena is
/// immutable for the session and outlives every value constructed from it), so
/// the SAFETY justification lives here once instead of being repeated ~70×.
/// The `'static` return lifetime is a placeholder — once `'bump` is threaded
/// through, `Str` becomes `&'bump [u8]` and this fn is deleted.
///
/// # Safety
/// `p` must be a non-null fat pointer into the parser's source text or bump
/// arena, and that backing storage must outlive the returned reference.
#[inline(always)]
pub(crate) unsafe fn arena_str(p: Str) -> &'static [u8] {
    // SAFETY: caller contract (documented above) guarantees `p` is a non-null,
    // well-aligned fat pointer into the parser's immutable source/bump arena,
    // whose backing storage outlives the returned reference.
    unsafe { &*p }
}
pub use compat::Feature;
/// Alias of `error::ParserErrorKind`.
pub use error::ParserErrorKind as ParseErrorKind;
pub use error::ParserErrorKind as ErrorKind;
pub use properties::custom::{TokenList, TokenListFns};
pub use values::ident::{CustomIdentFns, DashedIdentFns, IdentFns};
pub use values::string::{CssString as CSSString, CssStringFns as CSSStringFns};

// `css::generic::*` is an alternate spelling of the protocol traits +
// reflection helpers in `generics`; alias both spellings so value/property
// modules can use `crate::generic::partial_cmp_f32` etc.
pub use generics as generic;
pub use generics::{implement_deep_clone, implement_eql, implement_hash};
// Same-name trait + derive macro re-export so `#[derive(bun_css::DeepClone)]`
// (and `use bun_css::DeepClone;` at leaf sites) brings both into scope.
pub use generics::{CssEql, DeepClone};
// Keyword-enum / tagged-union derive macros. The `EnumProperty` *trait* is
// re-exported above from `css_parser`; the *derive* of the same name lives in
// the proc-macro crate.
pub use bun_css_derive::{DefineEnumProperty, Parse, ToCss};
// Serializer + dtoa helpers live in the parser hub but are referenced as
// `css::serializer` / `css::f32_length_with_5_digits` from value modules.
pub use css_parser::{dtoa_short, f32_length_with_5_digits, serializer, to_css};

#[path = "generics.rs"]
pub mod generics;

// ─── parser core + rule orchestration ─────────────────────────────────────
#[path = "css_parser.rs"]
pub mod css_parser;
#[path = "printer.rs"]
pub mod printer;
#[path = "values/mod.rs"]
pub mod values;

/// Re-exports from `values::{color,ident,url}` so callers that still use
/// the legacy `values_stub` path resolve to the canonical types.
pub mod values_stub {
    /// Re-export the real `values/color.rs` surface so any remaining
    /// `values_stub::color::*` paths resolve to the canonical types.
    pub mod color {
        pub use crate::values::color::*;

        pub type CssColorParseResult = crate::values::color::ParseResult;

        /// https://drafts.csswg.org/css-color/#hsl-to-rgb (`hue` is 0..1 here).
        /// Real body lives in `css_parser::color::hsl_to_rgb`; re-exported for
        /// any callers that reached it via the stub path.
        pub use crate::css_parser::color::hsl_to_rgb;
    }

    /// Re-export of the real `values/ident.rs`.
    pub mod ident {
        pub use crate::values::ident::*;
    }
}

// ─── stub re-exports referenced cross-crate ────────────────────────────────

/// Single-variant error type returned by every `to_css` path; the *kind*
/// lives in `Printer.error_kind` (PrinterError) — this is just the bubbled
/// signal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrintErr {
    CSSPrintError,
}
impl PrintErr {
    #[inline]
    pub fn name(self) -> &'static str {
        "CSSPrintError"
    }
}
impl core::fmt::Display for PrintErr {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("CSS print error")
    }
}
impl core::error::Error for PrintErr {}

/// Return shape used by every `to_css`
/// path. Distinct from `css_parser::PrintResult<T> = Maybe<T, PrinterError>`,
/// which carries the rich `Err<PrinterErrorKind>` — this is just the bubbled
/// signal (the *kind* lives in `Printer.error_kind`).
pub(crate) type PrintResult<T = ()> = core::result::Result<T, PrintErr>;

pub use dependencies::Dependency;

// Re-export the hub types at the crate root so `bun_css::Foo` paths resolve
// for css_jsc / bundler.
pub use css_parser::{
    DefaultAtRule, LocalsResultsMap, MinifyOptions, Parser, ParserFlags, ParserInput,
    ParserOptions, StyleAttribute, StyleSheet, StylesheetExtra, ToCssResult,
};
pub use printer::{ImportInfo, Printer, PrinterOptions, PseudoClasses};
/// Dependent crates name this `ImportRecordHandler`; the surviving type is
/// `printer::ImportInfo`, exposed under both names.
pub type ImportRecordHandler<'a> = printer::ImportInfo<'a>;
pub use values::color::{CssColor, FloatColor, LABColor, LabColor, PredefinedColor, RGBA};
pub use values_stub::color::CssColorParseResult;

// Cross-crate re-exports.
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
// without pulling in the 6k-line parser hub.

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
    // the panicking variant is exposed as `from_name_str`.
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
        // Arithmetic subtraction on bits, not set difference; callers depend on it.
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
// compile without the 6k-line parser hub.

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

#[derive(Copy, Clone, Debug)]
pub struct Dimension {
    pub num: Num,
    /// e.g. "px"
    // Borrows the parser arena/source; `&'static` placeholder per PORTING.md §AST crates.
    pub unit: &'static [u8],
}

/// CSS lexer token. Data-only definition hoisted out of `css_parser.rs`; the
/// `to_css*`/`eql`/`hash` impls stay in `css_parser.rs` since they depend on
/// `serializer::*` and `generics`.
// Every `&'static [u8]` payload actually borrows the parser arena/source text and
// must not outlive the arena; `&'static` is the crate-wide placeholder until the
// bumpalo arena lifetime is plumbed through.
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
        // Minimal rendering for error messages. Full CSS serialization
        // lives in `css_parser.rs` via `serializer::*`.
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
