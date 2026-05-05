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
gated_mod!(values, "values/mod.rs");
gated_mod!(selectors, "selectors/selector.rs");
gated_mod!(context, "context.rs");
gated_mod!(declaration, "declaration.rs");
gated_mod!(printer, "printer.rs");
gated_mod!(generics, "generics.rs");
gated_mod!(media_query, "media_query.rs");
gated_mod!(css_parser, "css_parser.rs");

// ─── stub re-exports referenced cross-crate ────────────────────────────────
// TODO(b1): real types come back when modules are un-gated in B-2.
pub type Printer = ();
pub type PrintErr = ();
pub type CustomMedia = ();
pub use dependencies::Dependency;

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
