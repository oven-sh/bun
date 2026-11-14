#![feature(allocator_api)]
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
#[path = "targets.rs"]
pub mod targets;

#[path = "crate_error.rs"]
pub mod crate_error;
pub use crate_error::{Error as CrateError, Result as CrateResult};
#[path = "css_modules.rs"]
pub mod css_modules;
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
pub(crate) use context::PropertyHandlerContext;
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
    ParserState, enum_property_util, nth, parse_utility, signfns,
};

// ─── selectors/ crate-root surface ────────────────────────────────────────
// The selector grammar references these via `bun_css::*`.
pub(crate) use compat::Feature;
/// Alias of `error::ParserErrorKind`.
pub use error::ParserErrorKind as ParseErrorKind;
pub use properties::custom::{TokenList, TokenListFns};
pub use values::ident::IdentFns;
pub use values::string::{CssString as CSSString, CssStringFns as CSSStringFns};

// `css::generic::*` is an alternate spelling of the protocol traits +
// reflection helpers in `generics`; alias both spellings so value/property
// modules can use `crate::generic::partial_cmp_f32` etc.
pub use generics as generic;
pub use generics::{implement_deep_clone, implement_hash};
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
pub use values::color::{CssColor, FloatColor, LABColor, PredefinedColor, RGBA};

// Cross-crate re-exports.
pub use error::{
    BasicParseErrorKind, Err, ErrorLocation, MinifyError, MinifyErrorKind, ParseError, ParserError,
    ParserErrorKind, PrinterError, PrinterErrorKind, SelectorError,
};
pub(crate) use logical::PropertyCategory;
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
    /// Fields listed here so we can iterate them in the order we want
    pub(crate) const FIELDS: &'static [VendorPrefix] = &[
        VendorPrefix::WEBKIT,
        VendorPrefix::MOZ,
        VendorPrefix::MS,
        VendorPrefix::O,
        VendorPrefix::NONE,
    ];

    // NOTE: bitflags 2.x already generates `from_name(&str) -> Option<Self>`;
    // the panicking variant is exposed as `from_name_str`.
    #[inline]
    pub(crate) fn from_name_str(name: &str) -> VendorPrefix {
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
    pub(crate) fn or_none(self) -> VendorPrefix {
        self.or(VendorPrefix::NONE)
    }

    /// **WARNING**: NOT THE SAME as bitwise-or!!
    #[inline]
    pub(crate) fn or(self, other: VendorPrefix) -> VendorPrefix {
        if self.is_empty() { other } else { self }
    }

    pub(crate) fn as_bits(self) -> u8 {
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
    pub(crate) fn strip_from(name: &[u8]) -> (VendorPrefix, &[u8]) {
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
// Hoisted from css_parser.rs / rules/mod.rs so leaf modules (error)
// compile without the 6k-line parser hub.

/// Line/column within a single source. Column is 1-based, line is 0-based.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct SourceLocation {
    pub(crate) line: u32,
    pub(crate) column: u32,
}

/// Cross-source location (carries a source-map source index).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, DeepClone)]
pub struct Location {
    /// The index of the source file within the source map.
    pub(crate) source_index: u32,
    /// The line number, starting at 0.
    pub(crate) line: u32,
    /// The column number within a line, starting at 1. Counted in UTF-16 code units.
    pub(crate) column: u32,
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
    pub(crate) has_sign: bool,
    pub(crate) value: f32,
    pub(crate) int_value: Option<i32>,
}

#[derive(Copy, Clone, Debug)]
pub struct Dimension<'bump> {
    pub(crate) num: Num,
    /// e.g. "px"
    pub(crate) unit: &'bump [u8],
}

/// CSS lexer token. Data-only definition hoisted out of `css_parser.rs`; the
/// `to_css*`/`hash` impls stay in `css_parser.rs` since they depend on
/// `serializer::*` and `generics`.
// `Copy`: every payload is a borrowed slice or scalar, and with `Copy` the
// derived `clone()` is a plain 24-byte copy instead of a per-variant match.
#[derive(Clone, Copy, Debug)]
pub enum Token<'bump> {
    Ident(&'bump [u8]),
    Function(&'bump [u8]),
    AtKeyword(&'bump [u8]),
    UnrestrictedHash(&'bump [u8]),
    IdHash(&'bump [u8]),
    QuotedString(&'bump [u8]),
    BadString(&'bump [u8]),
    UnquotedUrl(&'bump [u8]),
    BadUrl(&'bump [u8]),
    /// A `<delim-token>` — single codepoint. In practice always ASCII.
    Delim(u32),
    Number(Num),
    Percentage {
        has_sign: bool,
        unit_value: f32,
        int_value: Option<i32>,
    },
    Dimension(Dimension<'bump>),
    Whitespace(&'bump [u8]),
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
    Comment(&'bump [u8]),
}

impl core::fmt::Display for Token<'_> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        self.to_css_generic(&mut bun_io::FmtAdapter::new(f))
            .map_err(|_| core::fmt::Error)
    }
}
