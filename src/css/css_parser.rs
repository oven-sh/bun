//! CSS parser — port of `src/css/css_parser.zig`.
//!
//! This is an AST crate (see PORTING.md §Allocators): allocations are
//! arena-backed in the Zig original. Phase A keeps `&'bump Bump` threading
//! where it matters and drops `Allocator` params elsewhere.

use core::fmt;

use bun_alloc::Arena as Bump;
use bun_collections::{ArrayHashMap, BabyList, StaticBitSet};
use bun_logger::{self as logger, Log};
use bun_str::strings;

// ───────────────────────────── re-exports ─────────────────────────────

pub use bun_bundler::v2::Index as SrcIndex;
pub use bun_js_parser::ast::symbol::List as SymbolList;
pub use bun_options_types::{ImportKind, ImportRecord};

pub use crate::prefixes;
pub use crate::dependencies::{self, Dependency};
pub use crate::css_modules::{
    self, Config as CssModuleConfig, CssModule, CssModuleExports, CssModuleReference,
    CssModuleReferences,
};
pub use crate::rules::{
    self as css_rules, CssRule, CssRuleList, Location, MinifyContext, StyleContext,
    import::{ImportConditions, ImportRule},
    layer::{LayerName, LayerStatementRule},
    namespace::NamespaceRule,
    style::StyleRule,
    supports::{SupportsCondition, SupportsRule},
    tailwind::TailwindAtRule,
    unknown::UnknownAtRule,
};
pub use crate::rules::custom_media::CustomMediaRule as CustomMedia;
pub use crate::media_query::{self, MediaFeatureType, MediaList};
pub use crate::values::{
    self as css_values,
    color::{ColorFallbackKind, CssColor},
    ident::{
        CustomIdent, CustomIdentFns, CustomIdentList, DashedIdent, DashedIdentFns, Ident, IdentFns,
    },
    number::{CSSInteger, CSSIntegerFns, CSSNumber, CSSNumberFns},
    string::{CSSString, CSSStringFns},
    url::Url,
};
pub use crate::declaration::{self, DeclarationBlock, DeclarationHandler, DeclarationList};
pub use crate::properties::{
    self as css_properties, Property, PropertyId, PropertyIdTag,
    css_modules::{Composes, Specifier},
    custom::{TokenList, TokenListFns},
};
pub use crate::selectors::selector::{
    self,
    parser::{Component, PseudoClass, PseudoElement, Selector, SelectorList},
};
pub use crate::logical::{self, LogicalGroup, PropertyCategory};
pub use crate::printer::{self as css_printer, ImportInfo, Printer, PrinterOptions, Targets};
pub use crate::targets::{self, Features};
pub use crate::context::PropertyHandlerContext;
pub use crate::compat::{self, Feature};
pub use crate::error::{
    self as errors_, fmt_printer_error, BasicParseError, BasicParseErrorKind, Err, ErrorLocation,
    MinifyErr, MinifyError, MinifyErrorKind, ParseError, ParserError, PrinterError,
    PrinterErrorKind, SelectorError,
};
pub use crate::generics::{
    self as generic, implement_deep_clone, implement_eql, implement_hash, HASH_SEED,
};
pub use crate::small_list::SmallList;

// `Maybe` in Zig is `bun.jsc.Node.Maybe` — a tagged result. In Rust we use
// `core::result::Result` directly; callers `.ok()`/`.err()` instead of
// `.asValue()`/`.asErr()`.
pub use core::result::Result as Maybe;

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum PrintErr {
    #[error("CSS print error")]
    CSSPrintError,
}

#[cold]
#[inline(never)]
pub fn oom(_e: bun_core::Error) -> ! {
    if cfg!(debug_assertions) {
        // Zig: assert(e == Allocator.Error.OutOfMemory)
    }
    bun_core::out_of_memory();
}

pub mod todo_stuff {
    pub const THINK_MEM_MGMT: &str = "TODO: think about memory management";
    pub const DEPTH: &str = "TODO: we need to go deeper";
    pub const MATCH_IGNORE_ASCII_CASE: &str = "TODO: implement match_ignore_ascii_case";
    pub const ENUM_PROPERTY: &str = "TODO: implement enum_property!";
    pub const MATCH_BYTE: &str = "TODO: implement match_byte!";
    pub const WARN: &str = "TODO: implement warning";
}

// ───────────────────────────── VendorPrefix ─────────────────────────────

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq, Default)]
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

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self.bits() {
            x if x == VendorPrefix::WEBKIT.bits() => dest.write_str("-webkit-"),
            x if x == VendorPrefix::MOZ.bits() => dest.write_str("-moz-"),
            x if x == VendorPrefix::MS.bits() => dest.write_str("-ms-"),
            x if x == VendorPrefix::O.bits() => dest.write_str("-o-"),
            _ => Ok(()),
        }
    }

    // TODO(port): `fromName` used Zig comptime field set; callers should use
    // the bitflag consts directly (e.g. `VendorPrefix::WEBKIT`).
    #[inline]
    pub fn from_name(name: &str) -> VendorPrefix {
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

// ───────────────────────────── SourceLocation ─────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SourceLocation {
    pub line: u32,
    pub column: u32,
}

impl SourceLocation {
    pub fn to_logger_location(&self, file: &[u8]) -> logger::Location {
        logger::Location {
            file: file.into(),
            line: i32::try_from(self.line).unwrap(),
            column: i32::try_from(self.column).unwrap(),
            ..Default::default()
        }
    }

    /// Create a new BasicParseError at this location for an unexpected token
    pub fn new_basic_unexpected_token_error(self, token: Token) -> ParseError<ParserError> {
        BasicParseError {
            kind: BasicParseErrorKind::UnexpectedToken(token),
            location: self,
        }
        .into_default_parse_error()
    }

    /// Create a new ParseError at this location for an unexpected token
    pub fn new_unexpected_token_error(self, token: Token) -> ParseError<ParserError> {
        ParseError {
            kind: errors_::ParseErrorKind::Basic(BasicParseErrorKind::UnexpectedToken(token)),
            location: self,
        }
    }

    // TODO(port): Zig used `anytype` + `@TypeOf` to dispatch on
    // `ParserError | BasicParseError | SelectorParseErrorKind`. In Rust this
    // becomes a trait `IntoParserError` implemented by each. Phase B wires it.
    pub fn new_custom_error(self, err: impl IntoParserError) -> ParseError<ParserError> {
        ParseError {
            kind: errors_::ParseErrorKind::Custom(err.into_parser_error()),
            location: self,
        }
    }
}

/// Dispatch trait for `SourceLocation::new_custom_error` (replaces Zig
/// `anytype` switch on `@TypeOf`).
pub trait IntoParserError {
    fn into_parser_error(self) -> ParserError;
}
// TODO(port): impl IntoParserError for ParserError / BasicParseError /
// selector::parser::SelectorParseErrorKind in Phase B.

pub type Error = Err<ParserError>;

pub type CssResult<T> = Maybe<T, ParseError<ParserError>>;
// Zig: `pub fn Result(comptime T: type) type { return Maybe(T, ParseError(ParserError)); }`
// Rust callers use `CssResult<T>` directly.

pub type PrintResult<T> = Maybe<T, PrinterError>;

#[cold]
pub fn todo(msg: &str) -> ! {
    // bun.analytics.Features.todo_panic = 1;
    // TODO(port): analytics counter
    panic!("TODO: {msg}");
}

/// `voidWrap` adapted: wraps a `fn(&mut Parser) -> CssResult<T>` into a
/// `fn((), &mut Parser) -> CssResult<T>` so it fits closure-taking helpers.
#[inline]
pub fn void_wrap<T>(
    parsefn: fn(&mut Parser) -> CssResult<T>,
) -> impl FnMut((), &mut Parser) -> CssResult<T> {
    move |(), p| parsefn(p)
}

// ───────────────────────── Derive*-style comptime helpers ─────────────────────────
//
// The Zig file defines `DefineListShorthand`, `DefineShorthand`,
// `DefineRectShorthand`, `DefineSizeShorthand`, `DeriveParse`, `DeriveToCss`,
// `DefineEnumProperty`, `DeriveValueType` — all of which use `@typeInfo` /
// `@field` comptime reflection to generate `parse`/`toCss`/etc. for arbitrary
// types. PORTING.md §Comptime reflection: the protocol becomes a trait
// (`ToCss`, `Parse`, `EnumProperty`, ...) and per-type impls are generated by
// a `#[derive(...)]` proc-macro. We declare the traits here and stub the
// helper bodies that callers in other files reference.

/// Shorthand longhand-reconstruction helpers.
/// TODO(port): Zig version was `@compileError(todo_stuff.depth)` for every fn
/// body; preserve that as `todo!()`.
pub trait DefineShorthand: Sized {
    fn from_longhands(_decls: &DeclarationBlock, _vendor_prefix: VendorPrefix) -> Option<(Self, bool)> {
        todo!("{}", todo_stuff::DEPTH)
    }
    fn longhands(_vendor_prefix: VendorPrefix) -> &'static [PropertyId] {
        todo!("{}", todo_stuff::DEPTH)
    }
    fn longhand(&self, _property_id: &PropertyId) -> Option<Property> {
        todo!("{}", todo_stuff::DEPTH)
    }
    fn set_longhand(&mut self, _property: &Property) -> bool {
        todo!("{}", todo_stuff::DEPTH)
    }
}

/// Marker trait — Zig's `DefineListShorthand` does nothing.
pub trait DefineListShorthand {}

/// Rect shorthand: `top right bottom left` parsed via `Rect<V>`.
/// TODO(port): becomes `#[derive(RectShorthand)]` over a 4-field struct.
pub trait DefineRectShorthand<V: generic::Parse + generic::ToCss>: Sized {
    fn parse(input: &mut Parser) -> CssResult<Self>;
    fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr>;
}

/// Size shorthand: 2-field struct parsed via `Size2D<V>`.
/// TODO(port): becomes `#[derive(SizeShorthand)]`.
pub trait DefineSizeShorthand<V: generic::Parse + generic::ToCss>: Sized {
    fn parse(input: &mut Parser) -> CssResult<Self>;
    fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr>;
}

/// `DeriveParse` — comptime-generated `parse()` for enums and `union(enum)`s.
/// TODO(port): proc-macro `#[derive(Parse)]`. The Zig body branches on
/// `@typeInfo` to interleave void-variant ident matching with payload-variant
/// `tryParse` calls in declaration order. The full algorithm is documented in
/// the Zig source comments (lines 562–798).
pub trait DeriveParse: Sized {
    fn parse(input: &mut Parser) -> CssResult<Self>;
}

/// `DeriveToCss` — comptime-generated `toCss()` for enums and `union(enum)`s.
/// TODO(port): proc-macro `#[derive(ToCss)]`. Handles void variants (writes
/// the variant name), payload variants with `.toCss()`, and anonymous-struct
/// payloads with `__generateToCss` markers.
pub trait DeriveToCss {
    fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr>;
}

/// `enum_property_util` — generic `parse`/`toCss`/`asStr` for plain enums.
pub mod enum_property_util {
    use super::*;

    // TODO(port): `as_str` / `parse` / `to_css` here used Zig
    // `bun.ComptimeEnumMap` + `@tagName`. In Rust this is
    // `strum::IntoStaticStr` + `strum::EnumString` (case-insensitive). Callers
    // should `#[derive(EnumProperty)]` and use the trait below.
    pub fn as_str<T: Into<&'static str> + Copy>(this: &T) -> &'static str {
        (*this).into()
    }

    pub fn parse<T: EnumProperty>(input: &mut Parser) -> CssResult<T> {
        let location = input.current_source_location();
        let ident = match input.expect_ident() {
            Ok(v) => v,
            Err(e) => return Err(e),
        };
        if let Some(x) = T::from_ascii_case_insensitive(ident) {
            return Ok(x);
        }
        Err(location.new_unexpected_token_error(Token::Ident(ident)))
    }

    pub fn to_css<T: Into<&'static str> + Copy>(this: &T, dest: &mut Printer) -> Result<(), PrintErr> {
        dest.write_str(as_str(this))
    }
}

/// Replaces Zig's `DefineEnumProperty` comptime fn.
pub trait EnumProperty: Sized + Copy + Into<&'static str> {
    fn from_ascii_case_insensitive(ident: &[u8]) -> Option<Self>;

    fn eql(lhs: &Self, rhs: &Self) -> bool
    where
        Self: PartialEq,
    {
        lhs == rhs
    }

    fn parse(input: &mut Parser) -> CssResult<Self> {
        enum_property_util::parse(input)
    }

    fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        dest.write_str((*self).into())
    }

    #[inline]
    fn deep_clone(&self) -> Self {
        *self
    }

    fn hash(&self, hasher: &mut bun_wyhash::Wyhash)
    where
        Self: Into<u32>,
    {
        // TODO(port): Zig hashed the raw enum int bytes.
        let tag: u32 = (*self).into();
        hasher.update(&tag.to_ne_bytes());
    }
}

/// `DeriveValueType` — maps each enum variant to a `MediaFeatureType` via a
/// comptime field map.
/// TODO(port): proc-macro `#[derive(ValueType)]` with attribute annotations.
pub trait DeriveValueType {
    fn value_type(&self) -> MediaFeatureType;
}

// ───────────────────────── core parse helpers ─────────────────────────

#[cold]
fn consume_until_end_of_block(block_type: BlockType, tokenizer: &mut Tokenizer) {
    let mut stack: SmallList<BlockType, 16> = SmallList::default();
    stack.push(block_type);
    // PERF(port): was appendAssumeCapacity

    while let Ok(tok) = tokenizer.next() {
        if let Some(b) = BlockType::closing(&tok) {
            if stack.last_unchecked() == b {
                let _ = stack.pop();
                if stack.len() == 0 {
                    return;
                }
            }
        }
        if let Some(bt) = BlockType::opening(&tok) {
            stack.push(bt);
        }
    }
}

fn parse_at_rule<P: AtRuleParser>(
    start: &ParserState,
    name: &[u8],
    input: &mut Parser,
    parser: &mut P,
) -> CssResult<P::AtRule> {
    let delimiters = Delimiters::SEMICOLON | Delimiters::CURLY_BRACKET;
    let prelude: P::Prelude = match input.parse_until_before(
        delimiters,
        |input2: &mut Parser| P::parse_prelude(parser, name, input2),
    ) {
        Ok(vvv) => vvv,
        Err(e) => {
            'out: {
                let tok = match input.next() {
                    Ok(v) => v,
                    Err(_) => break 'out,
                };
                if !matches!(*tok, Token::OpenCurly | Token::Semicolon) {
                    unreachable!("Should have consumed these delimiters");
                }
            }
            return Err(e);
        }
    };
    let next = match input.next() {
        Ok(v) => v.clone(),
        Err(_) => {
            return match P::rule_without_block(parser, prelude, start) {
                Ok(v) => Ok(v),
                Err(()) => Err(input.new_unexpected_token_error(Token::Semicolon)),
            };
        }
    };
    match next {
        Token::Semicolon => match P::rule_without_block(parser, prelude, start) {
            Ok(v) => Ok(v),
            Err(()) => Err(input.new_unexpected_token_error(Token::Semicolon)),
        },
        Token::OpenCurly => parse_nested_block(input, |input2: &mut Parser| {
            P::parse_block(parser, prelude, start, input2)
        }),
        _ => unreachable!(),
    }
}

fn parse_custom_at_rule_prelude<T: CustomAtRuleParser>(
    name: &[u8],
    input: &mut Parser,
    options: &ParserOptions,
    at_rule_parser: &mut T,
) -> CssResult<AtRulePrelude<T::Prelude>> {
    match T::parse_prelude(at_rule_parser, name, input, options) {
        Ok(prelude) => return Ok(AtRulePrelude::Custom(prelude)),
        Err(e) => {
            if matches!(
                e.kind,
                errors_::ParseErrorKind::Basic(BasicParseErrorKind::AtRuleInvalid(_))
            ) {
                // do nothing
            } else {
                return Err(input.new_custom_error(ParserError::AtRulePreludeInvalid));
            }
        }
    }

    options.warn(input.new_error(BasicParseErrorKind::AtRuleInvalid(name)));
    input.skip_whitespace();
    let tokens = TokenListFns::parse(input, options, 0)?;
    Ok(AtRulePrelude::Unknown { name, tokens })
}

fn parse_custom_at_rule_without_block<T: CustomAtRuleParser>(
    prelude: T::Prelude,
    start: &ParserState,
    options: &ParserOptions,
    at_rule_parser: &mut T,
    is_nested: bool,
) -> Maybe<CssRule<T::AtRule>, ()> {
    match T::rule_without_block(at_rule_parser, prelude, start, options, is_nested) {
        Ok(v) => Ok(CssRule::Custom(v)),
        Err(e) => Err(e),
    }
}

fn parse_custom_at_rule_body<T: CustomAtRuleParser>(
    prelude: T::Prelude,
    input: &mut Parser,
    start: &ParserState,
    options: &ParserOptions,
    at_rule_parser: &mut T,
    is_nested: bool,
) -> CssResult<T::AtRule> {
    let result = match T::parse_block(at_rule_parser, prelude, start, input, options, is_nested) {
        Ok(vv) => vv,
        Err(_e) => {
            // match &err.kind {
            //   ParseErrorKind::Basic(kind) => ParseError { ... },
            //   _ => input.new_error(BasicParseErrorKind::AtRuleBodyInvalid),
            // }
            todo("This part here");
        }
    };
    Ok(result)
}

fn parse_qualified_rule<P: QualifiedRuleParser>(
    start: &ParserState,
    input: &mut Parser,
    parser: &mut P,
    delimiters: Delimiters,
) -> CssResult<P::QualifiedRule> {
    let prelude_result =
        input.parse_until_before(delimiters, |i| P::parse_prelude(parser, i));
    if let Err(e) = input.expect_curly_bracket_block() {
        return Err(e);
    }
    let prelude = prelude_result?;
    parse_nested_block(input, |input2| P::parse_block(parser, prelude, start, input2))
}

fn parse_until_before<T, C>(
    parser: &mut Parser,
    delimiters_: Delimiters,
    error_behavior: ParseUntilErrorBehavior,
    closure: C,
    parse_fn: impl FnOnce(C, &mut Parser) -> CssResult<T>,
) -> CssResult<T> {
    let delimiters = parser.stop_before | delimiters_;
    let result = {
        let mut delimited_parser = Parser {
            input: parser.input,
            at_start_of: parser.at_start_of.take(),
            stop_before: delimiters,
            import_records: parser.import_records,
            flags: parser.flags,
            extra: parser.extra,
        };
        // PORT NOTE: reshaped for borrowck — Zig held `parser.input` aliased.
        let result = delimited_parser.parse_entirely(closure, parse_fn);
        if matches!(error_behavior, ParseUntilErrorBehavior::Stop) && result.is_err() {
            return result;
        }
        if let Some(block_type) = delimited_parser.at_start_of {
            consume_until_end_of_block(block_type, &mut delimited_parser.input.tokenizer);
        }
        result
    };

    // FIXME: have a special-purpose tokenizer method for this that does less work.
    loop {
        if delimiters.contains(Delimiters::from_byte(parser.input.tokenizer.next_byte())) {
            break;
        }
        match parser.input.tokenizer.next() {
            Ok(token) => {
                if let Some(block_type) = BlockType::opening(&token) {
                    consume_until_end_of_block(block_type, &mut parser.input.tokenizer);
                }
            }
            _ => break,
        }
    }

    result
}

pub fn parse_until_after<T, C>(
    parser: &mut Parser,
    delimiters: Delimiters,
    error_behavior: ParseUntilErrorBehavior,
    closure: C,
    parsefn: impl FnOnce(C, &mut Parser) -> CssResult<T>,
) -> CssResult<T> {
    let result = parse_until_before(parser, delimiters, error_behavior, closure, parsefn);
    let is_err = result.is_err();
    if matches!(error_behavior, ParseUntilErrorBehavior::Stop) && is_err {
        return result;
    }
    let next_byte = parser.input.tokenizer.next_byte();
    if next_byte.is_some() && !parser.stop_before.contains(Delimiters::from_byte(next_byte)) {
        debug_assert!(delimiters.contains(Delimiters::from_byte(next_byte)));
        // We know this byte is ASCII.
        parser.input.tokenizer.advance(1);
        if next_byte == Some(b'{') {
            consume_until_end_of_block(BlockType::CurlyBracket, &mut parser.input.tokenizer);
        }
    }
    result
}

fn parse_nested_block<T>(
    parser: &mut Parser,
    parsefn: impl FnOnce(&mut Parser) -> CssResult<T>,
) -> CssResult<T> {
    let block_type = parser.at_start_of.take().unwrap_or_else(|| {
        panic!(
            "\nA nested parser can only be created when a Function,\n\
             ParenthisisBlock, SquareBracketBlock, or CurlyBracketBlock\n\
             token was just consumed."
        )
    });

    let closing_delimiter = match block_type {
        BlockType::CurlyBracket => Delimiters::CLOSE_CURLY_BRACKET,
        BlockType::SquareBracket => Delimiters::CLOSE_SQUARE_BRACKET,
        BlockType::Parenthesis => Delimiters::CLOSE_PARENTHESIS,
    };
    let mut nested_parser = Parser {
        input: parser.input,
        at_start_of: None,
        stop_before: closing_delimiter,
        import_records: parser.import_records,
        flags: parser.flags,
        extra: parser.extra,
    };
    // PORT NOTE: reshaped for borrowck — same aliasing as parse_until_before.
    let result = nested_parser.parse_entirely((), |(), p| parsefn(p));
    if let Some(block_type2) = nested_parser.at_start_of {
        consume_until_end_of_block(block_type2, &mut nested_parser.input.tokenizer);
    }
    consume_until_end_of_block(block_type, &mut parser.input.tokenizer);
    result
}

// ───────────────────────── parser-protocol traits ─────────────────────────
//
// Zig used `ValidQualifiedRuleParser(T)` etc. as comptime duck-type checks
// (`@hasDecl`). PORTING.md: trait bounds ARE that check.

/// Qualified rules are rules that apply styles to elements in a document.
pub trait QualifiedRuleParser {
    /// The intermediate representation of a qualified rule prelude.
    type Prelude;
    /// The finished representation of a qualified rule.
    type QualifiedRule;

    /// Parse the prelude of a qualified rule. For style rules, this is a
    /// Selector list. The given `input` is a "delimited" parser that ends
    /// where the prelude should end (before the next `{`).
    fn parse_prelude(this: &mut Self, input: &mut Parser) -> CssResult<Self::Prelude>;

    /// Parse the content of a `{ /* ... */ }` block for the body of the
    /// qualified rule.
    fn parse_block(
        this: &mut Self,
        prelude: Self::Prelude,
        start: &ParserState,
        input: &mut Parser,
    ) -> CssResult<Self::QualifiedRule>;
}

#[derive(Default, Clone, Copy)]
pub struct DefaultAtRule;

impl DefaultAtRule {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        dest.new_error(PrinterErrorKind::FmtError, None)
    }
    pub fn deep_clone(&self) -> Self {
        Self
    }
}

/// Same as `AtRuleParser` but modified to provide parser options.
/// Also added: `on_import_rule` to handle `@import` rules.
pub trait CustomAtRuleParser {
    type Prelude;
    type AtRule;

    fn parse_prelude(
        this: &mut Self,
        name: &[u8],
        input: &mut Parser,
        options: &ParserOptions,
    ) -> CssResult<Self::Prelude>;

    fn rule_without_block(
        this: &mut Self,
        prelude: Self::Prelude,
        start: &ParserState,
        options: &ParserOptions,
        is_nested: bool,
    ) -> Maybe<Self::AtRule, ()>;

    fn parse_block(
        this: &mut Self,
        prelude: Self::Prelude,
        start: &ParserState,
        input: &mut Parser,
        options: &ParserOptions,
        is_nested: bool,
    ) -> CssResult<Self::AtRule>;

    fn on_import_rule(this: &mut Self, import_rule: &mut ImportRule, start: u32, end: u32);
    fn on_layer_rule(this: &mut Self, layers: &SmallList<LayerName, 1>);
    fn enclosing_layer_length(this: &mut Self) -> u32;
    fn set_enclosing_layer(this: &mut Self, layer: LayerName);
    fn push_to_enclosing_layer(this: &mut Self, name: LayerName);
    fn reset_enclosing_layer(this: &mut Self, len: u32);
    fn bump_anon_layer_count(this: &mut Self, amount: i32);
}

/// At rules are rules that have the `@` symbol.
pub trait AtRuleParser {
    type Prelude;
    type AtRule;

    fn parse_prelude(this: &mut Self, name: &[u8], input: &mut Parser) -> CssResult<Self::Prelude>;
    fn rule_without_block(
        this: &mut Self,
        prelude: Self::Prelude,
        start: &ParserState,
    ) -> Maybe<Self::AtRule, ()>;
    fn parse_block(
        this: &mut Self,
        prelude: Self::Prelude,
        start: &ParserState,
        input: &mut Parser,
    ) -> CssResult<Self::AtRule>;
}

#[derive(Default)]
pub struct DefaultAtRuleParser;

impl CustomAtRuleParser for DefaultAtRuleParser {
    type Prelude = ();
    type AtRule = DefaultAtRule;

    fn parse_prelude(
        _this: &mut Self,
        name: &[u8],
        input: &mut Parser,
        _: &ParserOptions,
    ) -> CssResult<()> {
        Err(input.new_error(BasicParseErrorKind::AtRuleInvalid(name)))
    }

    fn parse_block(
        _this: &mut Self,
        _: (),
        _: &ParserState,
        input: &mut Parser,
        _: &ParserOptions,
        _: bool,
    ) -> CssResult<DefaultAtRule> {
        Err(input.new_error(BasicParseErrorKind::AtRuleBodyInvalid))
    }

    fn rule_without_block(
        _this: &mut Self,
        _: (),
        _: &ParserState,
        _: &ParserOptions,
        _: bool,
    ) -> Maybe<DefaultAtRule, ()> {
        Err(())
    }

    fn on_import_rule(_this: &mut Self, _: &mut ImportRule, _: u32, _: u32) {}
    fn on_layer_rule(_this: &mut Self, _: &SmallList<LayerName, 1>) {}
    fn enclosing_layer_length(_this: &mut Self) -> u32 { 0 }
    fn set_enclosing_layer(_this: &mut Self, _: LayerName) {}
    fn push_to_enclosing_layer(_this: &mut Self, _: LayerName) {}
    fn reset_enclosing_layer(_this: &mut Self, _: u32) {}
    fn bump_anon_layer_count(_this: &mut Self, _: i32) {}
}

/// We may want to enable this later
pub const ENABLE_TAILWIND_PARSING: bool = false;

pub type BundlerAtRule = DefaultAtRule;
// TODO(port): when ENABLE_TAILWIND_PARSING == true, this is `TailwindAtRule`.

pub struct BundlerAtRuleParser<'a> {
    pub import_records: &'a mut BabyList<ImportRecord>,
    pub layer_names: BabyList<LayerName>,
    pub options: &'a ParserOptions<'a>,
    /// Having _named_ layers nested inside of an _anonymous_ layer has no
    /// effect. See: https://drafts.csswg.org/css-cascade-5/#example-787042b6
    pub anon_layer_count: u32,
    pub enclosing_layer: LayerName,
}

impl<'a> CustomAtRuleParser for BundlerAtRuleParser<'a> {
    // TODO(port): when ENABLE_TAILWIND_PARSING, Prelude = enum { Tailwind(TailwindAtRule) }.
    type Prelude = ();
    type AtRule = BundlerAtRule;

    fn parse_prelude(
        _this: &mut Self,
        name: &[u8],
        input: &mut Parser,
        _: &ParserOptions,
    ) -> CssResult<Self::Prelude> {
        // TODO(port): tailwind branch (gated on ENABLE_TAILWIND_PARSING).
        Err(input.new_error(BasicParseErrorKind::AtRuleInvalid(name)))
    }

    fn parse_block(
        _this: &mut Self,
        _: (),
        _: &ParserState,
        input: &mut Parser,
        _: &ParserOptions,
        _: bool,
    ) -> CssResult<Self::AtRule> {
        Err(input.new_error(BasicParseErrorKind::AtRuleBodyInvalid))
    }

    fn rule_without_block(
        _this: &mut Self,
        _prelude: (),
        _: &ParserState,
        _: &ParserOptions,
        _: bool,
    ) -> Maybe<Self::AtRule, ()> {
        // TODO(port): tailwind branch.
        Err(())
    }

    fn on_import_rule(this: &mut Self, import_rule: &mut ImportRule, start_position: u32, end_position: u32) {
        let import_record_index = this.import_records.len();
        import_rule.import_record_idx = import_record_index;
        this.import_records.push(ImportRecord {
            path: bun_fs::Path::init(import_rule.url),
            kind: if import_rule.supports.is_some() { ImportKind::AtConditional } else { ImportKind::At },
            range: logger::Range {
                loc: logger::Loc { start: i32::try_from(start_position).unwrap() },
                len: i32::try_from(end_position - start_position).unwrap(),
            },
            ..Default::default()
        });
    }

    fn on_layer_rule(this: &mut Self, layers: &SmallList<LayerName, 1>) {
        if this.anon_layer_count > 0 {
            return;
        }
        this.layer_names.reserve(layers.len() as usize);
        for layer in layers.slice() {
            if this.enclosing_layer.v.len() > 0 {
                let mut cloned = LayerName { v: SmallList::default() };
                cloned.v.reserve((this.enclosing_layer.v.len() + layer.v.len()) as usize);
                cloned.v.extend_from_slice(this.enclosing_layer.v.slice());
                cloned.v.extend_from_slice(layer.v.slice());
                // PERF(port): was appendSliceAssumeCapacity
                this.layer_names.push(cloned);
            } else {
                this.layer_names.push(layer.deep_clone());
            }
        }
    }

    fn enclosing_layer_length(this: &mut Self) -> u32 {
        this.enclosing_layer.v.len()
    }

    fn set_enclosing_layer(this: &mut Self, layer: LayerName) {
        this.enclosing_layer = layer;
    }

    fn push_to_enclosing_layer(this: &mut Self, name: LayerName) {
        this.enclosing_layer.v.extend_from_slice(name.v.slice());
    }

    fn reset_enclosing_layer(this: &mut Self, len: u32) {
        this.enclosing_layer.v.set_len(len);
    }

    fn bump_anon_layer_count(this: &mut Self, amount: i32) {
        if amount > 0 {
            this.anon_layer_count += u32::try_from(amount).unwrap();
        } else {
            this.anon_layer_count -= amount.unsigned_abs();
        }
    }
}

// ───────────────────────────── AtRulePrelude ─────────────────────────────

pub enum AtRulePrelude<T> {
    FontFace,
    FontFeatureValues,
    FontPaletteValues(DashedIdent),
    CounterStyle(CustomIdent),
    Import {
        url: &'static [u8], // TODO(port): lifetime — arena-owned slice
        media: MediaList,
        supports: Option<SupportsCondition>,
        layer: Option<Option<LayerName>>,
    },
    Namespace {
        prefix: Option<&'static [u8]>, // TODO(port): lifetime
        url: &'static [u8],            // TODO(port): lifetime
    },
    Charset,
    CustomMedia {
        name: DashedIdent,
        media: MediaList,
    },
    Property {
        name: DashedIdent,
    },
    Media(MediaList),
    Supports(SupportsCondition),
    Viewport(VendorPrefix),
    Keyframes {
        name: css_rules::keyframes::KeyframesName,
        prefix: VendorPrefix,
    },
    Page(Vec<css_rules::page::PageSelector>),
    MozDocument,
    Layer(SmallList<LayerName, 1>),
    Container {
        name: Option<css_rules::container::ContainerName>,
        condition: css_rules::container::ContainerCondition,
    },
    StartingStyle,
    Nest(SelectorList),
    Scope {
        scope_start: Option<SelectorList>,
        scope_end: Option<SelectorList>,
    },
    Unknown {
        name: &'static [u8], // TODO(port): lifetime
        /// The tokens of the prelude
        tokens: TokenList,
    },
    Custom(T),
}

impl<T> AtRulePrelude<T> {
    pub fn allowed_in_style_rule(&self) -> bool {
        matches!(
            self,
            AtRulePrelude::Media(_)
                | AtRulePrelude::Supports(_)
                | AtRulePrelude::Container { .. }
                | AtRulePrelude::MozDocument
                | AtRulePrelude::Layer(_)
                | AtRulePrelude::StartingStyle
                | AtRulePrelude::Scope { .. }
                | AtRulePrelude::Nest(_)
                | AtRulePrelude::Unknown { .. }
                | AtRulePrelude::Custom(_)
        )
    }
}

// ───────────────────────────── TopLevelRuleParser ─────────────────────────────

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum TopLevelState {
    Start = 1,
    Layers = 2,
    Imports = 3,
    Namespaces = 4,
    Body = 5,
}

pub struct TopLevelRuleParser<'a, AtRuleParserT: CustomAtRuleParser> {
    pub options: &'a ParserOptions<'a>,
    pub state: TopLevelState,
    pub at_rule_parser: &'a mut AtRuleParserT,
    // TODO: think about memory management
    pub rules: &'a mut CssRuleList<AtRuleParserT::AtRule>,
    pub composes: &'a mut ComposesMap,
    pub composes_refs: SmallList<bun_bundler::v2::Ref, 2>,
    pub local_properties: &'a mut LocalPropertyUsage,
}

impl<'a, AtRuleParserT: CustomAtRuleParser> TopLevelRuleParser<'a, AtRuleParserT> {
    pub fn new(
        options: &'a ParserOptions<'a>,
        at_rule_parser: &'a mut AtRuleParserT,
        rules: &'a mut CssRuleList<AtRuleParserT::AtRule>,
        composes: &'a mut ComposesMap,
        local_properties: &'a mut LocalPropertyUsage,
    ) -> Self {
        Self {
            options,
            state: TopLevelState::Start,
            at_rule_parser,
            rules,
            composes,
            composes_refs: SmallList::default(),
            local_properties,
        }
    }

    pub fn nested(&mut self) -> NestedRuleParser<'_, AtRuleParserT> {
        NestedRuleParser {
            options: self.options,
            at_rule_parser: self.at_rule_parser,
            declarations: DeclarationList::default(),
            important_declarations: DeclarationList::default(),
            rules: self.rules,
            is_in_style_rule: false,
            allow_declarations: false,
            composes_state: ComposesState::DisallowEntirely,
            composes: self.composes,
            composes_refs: &mut self.composes_refs,
            local_properties: self.local_properties,
        }
    }
}

impl<'a, AtRuleParserT: CustomAtRuleParser> AtRuleParser for TopLevelRuleParser<'a, AtRuleParserT> {
    type Prelude = AtRulePrelude<AtRuleParserT::Prelude>;
    type AtRule = ();

    fn parse_prelude(this: &mut Self, name: &[u8], input: &mut Parser) -> CssResult<Self::Prelude> {
        // phf-style dispatch on at-rule name (case-insensitive).
        // TODO(port): Zig used `bun.ComptimeEnumMap(PreludeEnum)`; Phase B
        // wires `phf::Map` or `match_ignore_ascii_case!`.
        if strings::eql_case_insensitive_ascii(name, b"import", true) {
            if (this.state as u8) > (TopLevelState::Imports as u8) {
                return Err(input.new_custom_error(ParserError::UnexpectedImportRule));
            }
            let url_str = input.expect_url_or_string()?;

            let layer: Option<Option<LayerName>> =
                if input.try_parse(|p| p.expect_ident_matching(b"layer")).is_ok() {
                    Some(None)
                } else if input.try_parse(|p| p.expect_function_matching(b"layer")).is_ok() {
                    Some(Some(input.parse_nested_block(|p| LayerName::parse(p))?))
                } else {
                    None
                };

            let supports = if input.try_parse(|p| p.expect_function_matching(b"supports")).is_ok() {
                Some(input.parse_nested_block(|p| {
                    let result = p.try_parse(SupportsCondition::parse);
                    if result.is_err() {
                        SupportsCondition::parse_declaration(p)
                    } else {
                        result
                    }
                })?)
            } else {
                None
            };

            let media = MediaList::parse(input)?;

            return Ok(AtRulePrelude::Import { url: url_str, media, supports, layer });
        }
        if strings::eql_case_insensitive_ascii(name, b"namespace", true) {
            if (this.state as u8) > (TopLevelState::Namespaces as u8) {
                return Err(input.new_custom_error(ParserError::UnexpectedNamespaceRule));
            }
            let prefix = input.try_parse(Parser::expect_ident).ok();
            let namespace = input.expect_url_or_string()?;
            return Ok(AtRulePrelude::Namespace { prefix, url: namespace });
        }
        if strings::eql_case_insensitive_ascii(name, b"charset", true) {
            // @charset is removed by rust-cssparser if it's the first rule in
            // the stylesheet. Anything left is technically invalid, however,
            // users often concatenate CSS files together, so we are more
            // lenient and simply ignore @charset rules in the middle of a file.
            input.expect_string()?;
            return Ok(AtRulePrelude::Charset);
        }
        if strings::eql_case_insensitive_ascii(name, b"custom-media", true) {
            let custom_media_name = DashedIdentFns::parse(input)?;
            let media = MediaList::parse(input)?;
            return Ok(AtRulePrelude::CustomMedia { name: custom_media_name, media });
        }
        if strings::eql_case_insensitive_ascii(name, b"property", true) {
            let property_name = DashedIdentFns::parse(input)?;
            return Ok(AtRulePrelude::Property { name: property_name });
        }

        let mut nested_rule_parser = this.nested();
        <NestedRuleParser<'_, AtRuleParserT> as AtRuleParser>::parse_prelude(
            &mut nested_rule_parser,
            name,
            input,
        )
    }

    fn parse_block(
        this: &mut Self,
        prelude: Self::Prelude,
        start: &ParserState,
        input: &mut Parser,
    ) -> CssResult<()> {
        this.state = TopLevelState::Body;
        let mut nested_parser = this.nested();
        <NestedRuleParser<'_, AtRuleParserT> as AtRuleParser>::parse_block(
            &mut nested_parser,
            prelude,
            start,
            input,
        )
    }

    fn rule_without_block(
        this: &mut Self,
        prelude: Self::Prelude,
        start: &ParserState,
    ) -> Maybe<(), ()> {
        let loc_ = start.source_location();
        let loc = Location {
            source_index: this.options.source_index,
            line: loc_.line,
            column: loc_.column,
        };

        match prelude {
            AtRulePrelude::Import { url, media, supports, layer } => {
                this.state = TopLevelState::Imports;
                let mut import_rule = ImportRule {
                    url,
                    media,
                    supports,
                    layer: layer.map(|v| css_rules::import::Layer { v }),
                    loc,
                    ..Default::default()
                };
                AtRuleParserT::on_import_rule(
                    this.at_rule_parser,
                    &mut import_rule,
                    u32::try_from(start.position).unwrap(),
                    u32::try_from(start.position + 1).unwrap(),
                );
                this.rules.v.push(CssRule::Import(import_rule));
                Ok(())
            }
            AtRulePrelude::Namespace { prefix, url } => {
                this.state = TopLevelState::Namespaces;
                this.rules.v.push(CssRule::Namespace(NamespaceRule {
                    prefix: prefix.map(|p| Ident { v: p }),
                    url,
                    loc,
                }));
                Ok(())
            }
            AtRulePrelude::CustomMedia { name, media: query } => {
                this.state = TopLevelState::Body;
                this.rules.v.push(CssRule::CustomMedia(
                    css_rules::custom_media::CustomMediaRule { name, query, loc },
                ));
                Ok(())
            }
            AtRulePrelude::Layer(_) => {
                if (this.state as u8) <= (TopLevelState::Layers as u8) {
                    this.state = TopLevelState::Layers;
                } else {
                    this.state = TopLevelState::Body;
                }
                let mut nested_parser = this.nested();
                <NestedRuleParser<'_, AtRuleParserT> as AtRuleParser>::rule_without_block(
                    &mut nested_parser,
                    prelude,
                    start,
                )
            }
            AtRulePrelude::Charset => Ok(()),
            AtRulePrelude::Unknown { name, tokens: prelude2 } => {
                this.rules.v.push(CssRule::Unknown(UnknownAtRule {
                    name,
                    prelude: prelude2,
                    block: None,
                    loc,
                }));
                Ok(())
            }
            AtRulePrelude::Custom(_) => {
                this.state = TopLevelState::Body;
                let mut nested_parser = this.nested();
                <NestedRuleParser<'_, AtRuleParserT> as AtRuleParser>::rule_without_block(
                    &mut nested_parser,
                    prelude,
                    start,
                )
            }
            _ => Err(()),
        }
    }
}

impl<'a, AtRuleParserT: CustomAtRuleParser> QualifiedRuleParser
    for TopLevelRuleParser<'a, AtRuleParserT>
{
    type Prelude = SelectorList;
    type QualifiedRule = ();

    fn parse_prelude(this: &mut Self, input: &mut Parser) -> CssResult<SelectorList> {
        this.state = TopLevelState::Body;
        let mut nested_parser = this.nested();
        <NestedRuleParser<'_, AtRuleParserT> as QualifiedRuleParser>::parse_prelude(
            &mut nested_parser,
            input,
        )
    }

    fn parse_block(
        this: &mut Self,
        prelude: SelectorList,
        start: &ParserState,
        input: &mut Parser,
    ) -> CssResult<()> {
        let mut nested_parser = this.nested();
        <NestedRuleParser<'_, AtRuleParserT> as QualifiedRuleParser>::parse_block(
            &mut nested_parser,
            prelude,
            start,
            input,
        )
    }
}

// ───────────────────────────── NestedRuleParser ─────────────────────────────

pub enum ComposesState {
    Allow(SourceLocation),
    DisallowNested(SourceLocation),
    DisallowNotSingleClass(SourceLocation),
    DisallowEntirely,
}

pub struct NestedRuleParser<'a, T: CustomAtRuleParser> {
    pub options: &'a ParserOptions<'a>,
    pub at_rule_parser: &'a mut T,
    // todo_stuff.think_mem_mgmt
    pub declarations: DeclarationList,
    // todo_stuff.think_mem_mgmt
    pub important_declarations: DeclarationList,
    // todo_stuff.think_mem_mgmt
    pub rules: &'a mut CssRuleList<T::AtRule>,
    pub is_in_style_rule: bool,
    pub allow_declarations: bool,

    pub composes_state: ComposesState,
    pub composes_refs: &'a mut SmallList<bun_bundler::v2::Ref, 2>,
    pub composes: &'a mut ComposesMap,
    pub local_properties: &'a mut LocalPropertyUsage,
}

impl<'a, T: CustomAtRuleParser> NestedRuleParser<'a, T> {
    pub fn get_loc(&self, start: &ParserState) -> Location {
        let loc = start.source_location();
        Location {
            source_index: self.options.source_index,
            line: loc.line,
            column: loc.column,
        }
    }

    /// If css modules is enabled, we want to record each occurrence of the
    /// `composes` property for the bundler so we can generate the lazy JS
    /// import object later.
    pub fn record_composes(&mut self, composes: &mut Composes) {
        for ref_ in self.composes_refs.slice() {
            let entry = self.composes.entry(*ref_).or_insert_with(ComposesEntry::default);
            entry.composes.push(composes.deep_clone());
        }
    }

    pub fn parse_nested(
        &mut self,
        input: &mut Parser,
        is_style_rule: bool,
    ) -> CssResult<(DeclarationBlock, CssRuleList<T::AtRule>)> {
        // TODO: think about memory management in error cases
        let mut rules = CssRuleList::<T::AtRule>::default();
        let composes_state = if self.is_in_style_rule
            && matches!(self.composes_state, ComposesState::Allow(_))
        {
            let ComposesState::Allow(l) = self.composes_state else { unreachable!() };
            ComposesState::DisallowNested(l)
        } else {
            // TODO(port): Zig copies enum value; ComposesState may need Clone.
            core::mem::replace(&mut self.composes_state, ComposesState::DisallowEntirely)
        };
        let mut nested_parser = NestedRuleParser::<T> {
            options: self.options,
            at_rule_parser: self.at_rule_parser,
            declarations: DeclarationList::default(),
            important_declarations: DeclarationList::default(),
            rules: &mut rules,
            is_in_style_rule: self.is_in_style_rule || is_style_rule,
            allow_declarations: self.allow_declarations || self.is_in_style_rule || is_style_rule,
            composes_state,
            composes: self.composes,
            composes_refs: self.composes_refs,
            local_properties: self.local_properties,
        };
        // PORT NOTE: reshaped for borrowck — Zig held `self.*` aliased.

        let parse_declarations =
            <Self as RuleBodyItemParser>::parse_declarations(&nested_parser);
        // TODO: think about memory management
        // PERF(port): was arena bulk-free — profile in Phase B
        let mut errors: Vec<ParseError<ParserError>> = Vec::new();
        let mut iter = RuleBodyParser::new(input, &mut nested_parser);

        while let Some(result) = iter.next() {
            if let Err(e) = result {
                if parse_declarations {
                    iter.parser.declarations.clear();
                    iter.parser.important_declarations.clear();
                    errors.push(e);
                } else {
                    if iter.parser.options.error_recovery {
                        iter.parser.options.warn(e);
                        continue;
                    }
                    return Err(e);
                }
            }
        }

        if parse_declarations {
            if !errors.is_empty() {
                if self.options.error_recovery {
                    for e in errors {
                        self.options.warn(e);
                    }
                } else {
                    return Err(errors.remove(0));
                }
            }
        }

        Ok((
            DeclarationBlock {
                declarations: nested_parser.declarations,
                important_declarations: nested_parser.important_declarations,
            },
            rules,
        ))
    }

    pub fn parse_style_block(&mut self, input: &mut Parser) -> CssResult<CssRuleList<T::AtRule>> {
        let srcloc = input.current_source_location();
        let loc = Location {
            source_index: self.options.source_index,
            line: srcloc.line,
            column: srcloc.column,
        };

        // Declarations can be immediately within @media and @supports blocks
        // that are nested within a parent style rule. These act the same way
        // as if they were nested within a `& { ... }` block.
        let (declarations, mut rules) = self.parse_nested(input, false)?;

        if declarations.len() > 0 {
            rules.v.insert(
                0,
                CssRule::Style(StyleRule {
                    selectors: SelectorList::from_selector(
                        Selector::from_component(Component::Nesting),
                    ),
                    declarations,
                    vendor_prefix: VendorPrefix::default(),
                    rules: CssRuleList::default(),
                    loc,
                }),
            );
        }

        Ok(rules)
    }
}

impl<'a, T: CustomAtRuleParser> AtRuleParser for NestedRuleParser<'a, T> {
    type Prelude = AtRulePrelude<T::Prelude>;
    type AtRule = ();

    fn parse_prelude(this: &mut Self, name: &[u8], input: &mut Parser) -> CssResult<Self::Prelude> {
        let result: Self::Prelude = 'brk: {
            // TODO(port): Zig `ComptimeEnumMap(PreludeEnum)` ASCII-CI dispatch.
            // Phase B: replace these chained if-eql with `match_ignore_ascii_case!`.
            if strings::eql_case_insensitive_ascii(name, b"media", true) {
                break 'brk AtRulePrelude::Media(MediaList::parse(input)?);
            }
            if strings::eql_case_insensitive_ascii(name, b"supports", true) {
                break 'brk AtRulePrelude::Supports(SupportsCondition::parse(input)?);
            }
            if strings::eql_case_insensitive_ascii(name, b"font-face", true) {
                break 'brk AtRulePrelude::FontFace;
            }
            if strings::eql_case_insensitive_ascii(name, b"font-palette-values", true) {
                break 'brk AtRulePrelude::FontPaletteValues(DashedIdentFns::parse(input)?);
            }
            if strings::eql_case_insensitive_ascii(name, b"counter-style", true) {
                break 'brk AtRulePrelude::CounterStyle(CustomIdentFns::parse(input)?);
            }
            if strings::eql_case_insensitive_ascii(name, b"viewport", true)
                || strings::eql_case_insensitive_ascii(name, b"-ms-viewport", true)
            {
                let prefix = if strings::starts_with_case_insensitive_ascii(name, b"-ms") {
                    VendorPrefix::MS
                } else {
                    VendorPrefix::NONE
                };
                break 'brk AtRulePrelude::Viewport(prefix);
            }
            if strings::eql_case_insensitive_ascii(name, b"keyframes", true)
                || strings::eql_case_insensitive_ascii(name, b"-webkit-keyframes", true)
                || strings::eql_case_insensitive_ascii(name, b"-moz-keyframes", true)
                || strings::eql_case_insensitive_ascii(name, b"-o-keyframes", true)
                || strings::eql_case_insensitive_ascii(name, b"-ms-keyframes", true)
            {
                let prefix = if strings::starts_with_case_insensitive_ascii(name, b"-webkit") {
                    VendorPrefix::WEBKIT
                } else if strings::starts_with_case_insensitive_ascii(name, b"-moz") {
                    VendorPrefix::MOZ
                } else if strings::starts_with_case_insensitive_ascii(name, b"-o-") {
                    VendorPrefix::O
                } else if strings::starts_with_case_insensitive_ascii(name, b"-ms") {
                    VendorPrefix::MS
                } else {
                    VendorPrefix::NONE
                };
                let keyframes_name =
                    input.try_parse(css_rules::keyframes::KeyframesName::parse)?;
                break 'brk AtRulePrelude::Keyframes { name: keyframes_name, prefix };
            }
            if strings::eql_case_insensitive_ascii(name, b"page", true) {
                let selectors = input
                    .try_parse(|input2| {
                        input2.parse_comma_separated(css_rules::page::PageSelector::parse)
                    })
                    .unwrap_or_default();
                break 'brk AtRulePrelude::Page(selectors);
            }
            if strings::eql_case_insensitive_ascii(name, b"-moz-document", true) {
                // Firefox only supports the url-prefix() function with no
                // arguments as a legacy CSS hack.
                input.expect_function_matching(b"url-prefix")?;
                input.parse_nested_block(|input2| {
                    // Firefox also allows an empty string as an argument...
                    let _ = input2.try_parse(|input2| {
                        let s = input2.expect_string()?;
                        if !s.is_empty() {
                            return Err(input2.new_custom_error(ParserError::InvalidValue));
                        }
                        Ok(())
                    });
                    input2.expect_exhausted()
                })?;
                break 'brk AtRulePrelude::MozDocument;
            }
            if strings::eql_case_insensitive_ascii(name, b"layer", true) {
                let names = match SmallList::<LayerName, 1>::parse(input) {
                    Ok(vv) => vv,
                    Err(e) => {
                        if matches!(
                            e.kind,
                            errors_::ParseErrorKind::Basic(BasicParseErrorKind::EndOfInput)
                        ) {
                            SmallList::default()
                        } else {
                            return Err(e);
                        }
                    }
                };
                break 'brk AtRulePrelude::Layer(names);
            }
            if strings::eql_case_insensitive_ascii(name, b"container", true) {
                let container_name =
                    input.try_parse(css_rules::container::ContainerName::parse).ok();
                let condition = css_rules::container::ContainerCondition::parse(input)?;
                break 'brk AtRulePrelude::Container { name: container_name, condition };
            }
            if strings::eql_case_insensitive_ascii(name, b"starting-style", true) {
                break 'brk AtRulePrelude::StartingStyle;
            }
            if strings::eql_case_insensitive_ascii(name, b"scope", true) {
                let mut selector_parser = selector::parser::SelectorParser {
                    is_nesting_allowed: true,
                    options: this.options,
                    ..Default::default()
                };
                let scope_start = if input.try_parse(Parser::expect_parenthesis_block).is_ok() {
                    Some(input.parse_nested_block(|input2| {
                        SelectorList::parse_relative(
                            &mut selector_parser,
                            input2,
                            selector::parser::ErrorRecovery::IgnoreInvalidSelector,
                            selector::parser::NestingRequirement::None,
                        )
                    })?)
                } else {
                    None
                };
                let scope_end = if input.try_parse(|p| p.expect_ident_matching(b"to")).is_ok() {
                    input.expect_parenthesis_block()?;
                    Some(input.parse_nested_block(|input2| {
                        SelectorList::parse_relative(
                            &mut selector_parser,
                            input2,
                            selector::parser::ErrorRecovery::IgnoreInvalidSelector,
                            selector::parser::NestingRequirement::None,
                        )
                    })?)
                } else {
                    None
                };
                break 'brk AtRulePrelude::Scope { scope_start, scope_end };
            }
            if strings::eql_case_insensitive_ascii(name, b"nest", true) {
                if this.is_in_style_rule {
                    this.options.warn(input.new_custom_error(ParserError::DeprecatedNestRule));
                    let mut selector_parser = selector::parser::SelectorParser {
                        is_nesting_allowed: true,
                        options: this.options,
                        ..Default::default()
                    };
                    let selectors = SelectorList::parse(
                        &mut selector_parser,
                        input,
                        selector::parser::ErrorRecovery::DiscardList,
                        selector::parser::NestingRequirement::Contained,
                    )?;
                    break 'brk AtRulePrelude::Nest(selectors);
                }
            }

            parse_custom_at_rule_prelude(name, input, this.options, this.at_rule_parser)?
        };

        if this.is_in_style_rule && !result.allowed_in_style_rule() {
            return Err(input.new_error(BasicParseErrorKind::AtRuleInvalid(name)));
        }

        Ok(result)
    }

    fn parse_block(
        this: &mut Self,
        prelude: Self::Prelude,
        start: &ParserState,
        input: &mut Parser,
    ) -> CssResult<()> {
        let loc = this.get_loc(start);
        match prelude {
            AtRulePrelude::FontFace => {
                let mut decl_parser = css_rules::font_face::FontFaceDeclarationParser::default();
                let mut parser = RuleBodyParser::new(input, &mut decl_parser);
                // todo_stuff.think_mem_mgmt
                // PERF(port): was arena bulk-free — profile in Phase B
                let mut properties: Vec<css_rules::font_face::FontFaceProperty> = Vec::new();
                while let Some(result) = parser.next() {
                    if let Ok(decl) = result {
                        properties.push(decl);
                    }
                }
                this.rules.v.push(CssRule::FontFace(
                    css_rules::font_face::FontFaceRule { properties, loc },
                ));
                Ok(())
            }
            AtRulePrelude::FontPaletteValues(name) => {
                let rule = css_rules::font_palette_values::FontPaletteValuesRule::parse(
                    name, input, loc,
                )?;
                this.rules.v.push(CssRule::FontPaletteValues(rule));
                Ok(())
            }
            AtRulePrelude::CounterStyle(name) => {
                this.rules.v.push(CssRule::CounterStyle(
                    css_rules::counter_style::CounterStyleRule {
                        name,
                        declarations: DeclarationBlock::parse(input, this.options)?,
                        loc,
                    },
                ));
                Ok(())
            }
            AtRulePrelude::Media(query) => {
                let rules = this.parse_style_block(input)?;
                this.rules.v.push(CssRule::Media(css_rules::media::MediaRule {
                    query,
                    rules,
                    loc,
                }));
                Ok(())
            }
            AtRulePrelude::Supports(condition) => {
                let rules = this.parse_style_block(input)?;
                this.rules.v.push(CssRule::Supports(css_rules::supports::SupportsRule {
                    condition,
                    rules,
                    loc,
                }));
                Ok(())
            }
            AtRulePrelude::Container { name, condition } => {
                let rules = this.parse_style_block(input)?;
                this.rules.v.push(CssRule::Container(css_rules::container::ContainerRule {
                    name,
                    condition,
                    rules,
                    loc,
                }));
                Ok(())
            }
            AtRulePrelude::Scope { scope_start, scope_end } => {
                let rules = this.parse_style_block(input)?;
                this.rules.v.push(CssRule::Scope(css_rules::scope::ScopeRule {
                    scope_start,
                    scope_end,
                    rules,
                    loc,
                }));
                Ok(())
            }
            AtRulePrelude::Viewport(vendor_prefix) => {
                this.rules.v.push(CssRule::Viewport(css_rules::viewport::ViewportRule {
                    vendor_prefix,
                    declarations: DeclarationBlock::parse(input, this.options)?,
                    loc,
                }));
                Ok(())
            }
            AtRulePrelude::Keyframes { name, prefix } => {
                let mut parser = css_rules::keyframes::KeyframesListParser::default();
                let mut iter = RuleBodyParser::new(input, &mut parser);
                // todo_stuff.think_mem_mgmt
                // PERF(port): was arena bulk-free — profile in Phase B
                let mut keyframes: Vec<css_rules::keyframes::Keyframe> = Vec::new();
                while let Some(result) = iter.next() {
                    if let Ok(keyframe) = result {
                        keyframes.push(keyframe);
                    }
                }
                this.rules.v.push(CssRule::Keyframes(css_rules::keyframes::KeyframesRule {
                    name,
                    keyframes,
                    vendor_prefix: prefix,
                    loc,
                }));
                Ok(())
            }
            AtRulePrelude::Page(selectors) => {
                let rule = css_rules::page::PageRule::parse(selectors, input, loc, this.options)?;
                this.rules.v.push(CssRule::Page(rule));
                Ok(())
            }
            AtRulePrelude::MozDocument => {
                let rules = this.parse_style_block(input)?;
                this.rules.v.push(CssRule::MozDocument(
                    css_rules::document::MozDocumentRule { rules, loc },
                ));
                Ok(())
            }
            AtRulePrelude::Layer(layer) => {
                let name = if layer.len() == 0 {
                    None
                } else if layer.len() == 1 {
                    Some(layer.at(0).clone())
                } else {
                    return Err(input.new_error(BasicParseErrorKind::AtRuleBodyInvalid));
                };

                T::on_layer_rule(this.at_rule_parser, &layer);
                let old_len = T::enclosing_layer_length(this.at_rule_parser);
                if let Some(ref n) = name {
                    T::push_to_enclosing_layer(this.at_rule_parser, n.clone());
                } else {
                    T::bump_anon_layer_count(this.at_rule_parser, 1);
                }

                let rules = this.parse_style_block(input)?;

                if name.is_none() {
                    T::bump_anon_layer_count(this.at_rule_parser, -1);
                }
                T::reset_enclosing_layer(this.at_rule_parser, old_len);

                this.rules.v.push(CssRule::LayerBlock(
                    css_rules::layer::LayerBlockRule { name, rules, loc },
                ));
                Ok(())
            }
            AtRulePrelude::Property { name } => {
                this.rules.v.push(CssRule::Property(
                    css_rules::property::PropertyRule::parse(name, input, loc)?,
                ));
                Ok(())
            }
            AtRulePrelude::Import { .. }
            | AtRulePrelude::Namespace { .. }
            | AtRulePrelude::CustomMedia { .. }
            | AtRulePrelude::Charset => {
                // These rules don't have blocks
                Err(input.new_unexpected_token_error(Token::OpenCurly))
            }
            AtRulePrelude::StartingStyle => {
                let rules = this.parse_style_block(input)?;
                this.rules.v.push(CssRule::StartingStyle(
                    css_rules::starting_style::StartingStyleRule { rules, loc },
                ));
                Ok(())
            }
            AtRulePrelude::Nest(selectors) => {
                let (declarations, rules) = this.parse_nested(input, true)?;
                this.rules.v.push(CssRule::Nesting(css_rules::nesting::NestingRule {
                    style: StyleRule {
                        selectors,
                        declarations,
                        vendor_prefix: VendorPrefix::default(),
                        rules,
                        loc,
                    },
                    loc,
                }));
                Ok(())
            }
            AtRulePrelude::FontFeatureValues => unreachable!(),
            AtRulePrelude::Unknown { name, tokens } => {
                this.rules.v.push(CssRule::Unknown(UnknownAtRule {
                    name,
                    prelude: tokens,
                    block: Some(TokenListFns::parse(input, this.options, 0)?),
                    loc,
                }));
                Ok(())
            }
            AtRulePrelude::Custom(custom) => {
                this.rules.v.push(CssRule::Custom(parse_custom_at_rule_body(
                    custom,
                    input,
                    start,
                    this.options,
                    this.at_rule_parser,
                    this.is_in_style_rule,
                )?));
                Ok(())
            }
        }
    }

    fn rule_without_block(
        this: &mut Self,
        prelude: Self::Prelude,
        start: &ParserState,
    ) -> Maybe<(), ()> {
        let loc = this.get_loc(start);
        match prelude {
            AtRulePrelude::Layer(layer) => {
                if this.is_in_style_rule || layer.len() == 0 {
                    return Err(());
                }
                T::on_layer_rule(this.at_rule_parser, &layer);
                this.rules.v.push(CssRule::LayerStatement(LayerStatementRule {
                    names: layer,
                    loc,
                }));
                Ok(())
            }
            AtRulePrelude::Unknown { name, tokens } => {
                this.rules.v.push(CssRule::Unknown(UnknownAtRule {
                    name,
                    prelude: tokens,
                    block: None,
                    loc,
                }));
                Ok(())
            }
            AtRulePrelude::Custom(custom) => {
                let rule = parse_custom_at_rule_without_block(
                    custom,
                    start,
                    this.options,
                    this.at_rule_parser,
                    this.is_in_style_rule,
                )?;
                this.rules.v.push(rule);
                Ok(())
            }
            _ => Err(()),
        }
    }
}

impl<'a, T: CustomAtRuleParser> QualifiedRuleParser for NestedRuleParser<'a, T> {
    type Prelude = SelectorList;
    type QualifiedRule = ();

    fn parse_prelude(this: &mut Self, input: &mut Parser) -> CssResult<SelectorList> {
        let mut selector_parser = selector::parser::SelectorParser {
            is_nesting_allowed: true,
            options: this.options,
            ..Default::default()
        };
        if this.is_in_style_rule {
            SelectorList::parse_relative(
                &mut selector_parser,
                input,
                selector::parser::ErrorRecovery::DiscardList,
                selector::parser::NestingRequirement::Implicit,
            )
        } else {
            SelectorList::parse(
                &mut selector_parser,
                input,
                selector::parser::ErrorRecovery::DiscardList,
                selector::parser::NestingRequirement::None,
            )
        }
    }

    fn parse_block(
        this: &mut Self,
        selectors: SelectorList,
        start: &ParserState,
        input: &mut Parser,
    ) -> CssResult<()> {
        let loc = this.get_loc(start);
        // PORT NOTE: Zig `defer this.composes_refs.clearRetainingCapacity();`
        let _guard = scopeguard::guard((), |()| {
            // TODO(port): cannot capture &mut self.composes_refs across guard
        });
        // allow composes if:
        // - NOT in nested style rules
        // - AND there is only one class selector
        if input.flags.css_modules {
            'out: {
                if this.is_in_style_rule {
                    this.composes_state = ComposesState::DisallowNested(SourceLocation {
                        line: loc.line,
                        column: loc.column,
                    });
                    break 'out;
                }
                if selectors.v.len() != 1 {
                    this.composes_state = ComposesState::DisallowNotSingleClass(SourceLocation {
                        line: loc.line,
                        column: loc.column,
                    });
                    break 'out;
                }
                let sel = &selectors.v.slice()[0];
                if sel.components.len() != 1 {
                    this.composes_state = ComposesState::DisallowNotSingleClass(SourceLocation {
                        line: loc.line,
                        column: loc.column,
                    });
                    break 'out;
                }
                let comp = &sel.components[0];
                if let Some(r) = comp.as_class() {
                    let ref_ = r.as_ref().unwrap();
                    this.composes_refs.push(ref_);
                    this.composes_state = ComposesState::Allow(SourceLocation {
                        line: loc.line,
                        column: loc.column,
                    });
                    break 'out;
                }
                this.composes_state = ComposesState::DisallowNotSingleClass(SourceLocation {
                    line: loc.line,
                    column: loc.column,
                });
            }
        }
        let location = input.position();
        let (declarations, rules) = this.parse_nested(input, true)?;

        // We parsed a style rule with the `composes` property. Track which
        // properties it used so we can validate it later.
        if matches!(this.composes_state, ComposesState::Allow(_)) {
            let len = input.position() - location;
            let mut usage = PropertyBitset::default();
            let mut custom_properties: BabyList<&[u8]> = BabyList::default();
            fill_property_bit_set(&mut usage, &declarations, &mut custom_properties);

            let custom_properties_slice = custom_properties.slice();

            for ref_ in this.composes_refs.slice() {
                let entry = this.local_properties.entry(*ref_).or_insert_with(|| {
                    PropertyUsage {
                        range: logger::Range {
                            loc: logger::Loc { start: i32::try_from(location).unwrap() },
                            len: i32::try_from(len).unwrap(),
                        },
                        ..Default::default()
                    }
                });
                entry.fill(&usage, custom_properties_slice);
            }
        }

        this.rules.v.push(CssRule::Style(StyleRule {
            selectors,
            vendor_prefix: VendorPrefix::default(),
            declarations,
            rules,
            loc,
        }));

        this.composes_refs.clear();
        Ok(())
    }
}

pub trait RuleBodyItemParser: AtRuleParser + QualifiedRuleParser + DeclarationParser {
    fn parse_qualified(this: &Self) -> bool;
    fn parse_declarations(this: &Self) -> bool;
}

impl<'a, T: CustomAtRuleParser> RuleBodyItemParser for NestedRuleParser<'a, T> {
    fn parse_qualified(_this: &Self) -> bool {
        true
    }
    fn parse_declarations(this: &Self) -> bool {
        this.allow_declarations
    }
}

pub trait DeclarationParser {
    type Declaration;
    fn parse_value(this: &mut Self, name: &[u8], input: &mut Parser) -> CssResult<Self::Declaration>;
}

impl<'a, T: CustomAtRuleParser> DeclarationParser for NestedRuleParser<'a, T> {
    type Declaration = ();

    fn parse_value(this: &mut Self, name: &[u8], input: &mut Parser) -> CssResult<()> {
        declaration::parse_declaration_impl(
            name,
            input,
            &mut this.declarations,
            &mut this.important_declarations,
            this.options,
            this,
        )
    }
}

// ───────────────────────────── StyleSheetParser ─────────────────────────────

pub struct StyleSheetParser<'a, P: AtRuleParser + QualifiedRuleParser> {
    pub input: &'a mut Parser<'a>,
    pub parser: &'a mut P,
    pub any_rule_so_far: bool,
}

impl<'a, P> StyleSheetParser<'a, P>
where
    P: AtRuleParser + QualifiedRuleParser<QualifiedRule = <P as AtRuleParser>::AtRule>,
{
    pub fn new(input: &'a mut Parser<'a>, parser: &'a mut P) -> Self {
        Self { input, parser, any_rule_so_far: false }
    }

    pub fn next(&mut self) -> Option<CssResult<<P as AtRuleParser>::AtRule>> {
        loop {
            self.input.skip_cdc_and_cdo();

            let start = self.input.state();
            let at_keyword: Option<&[u8]> = match self.input.next_byte()? {
                b'@' => 'brk: {
                    let at_keyword: &Token = match self.input.next_including_whitespace_and_comments() {
                        Ok(vv) => vv,
                        Err(_) => {
                            self.input.reset(&start);
                            break 'brk None;
                        }
                    };
                    if let Token::AtKeyword(kw) = at_keyword {
                        break 'brk Some(*kw);
                    }
                    self.input.reset(&start);
                    None
                }
                _ => None,
            };

            if let Some(name) = at_keyword {
                let first_stylesheet_rule = !self.any_rule_so_far;
                self.any_rule_so_far = true;

                if first_stylesheet_rule
                    && strings::eql_case_insensitive_ascii(name, b"charset", true)
                {
                    let delimiters = Delimiters::SEMICOLON | Delimiters::CLOSE_CURLY_BRACKET;
                    let _ = self.input.parse_until_after(delimiters, |p| Parser::parse_empty(p));
                } else {
                    return Some(parse_at_rule(&start, name, self.input, self.parser));
                }
            } else {
                self.any_rule_so_far = true;
                return Some(parse_qualified_rule(
                    &start,
                    self.input,
                    self.parser,
                    Delimiters::CURLY_BRACKET,
                ));
            }
        }
    }
}

/// A result returned from `to_css`, including the serialized CSS and other
/// metadata depending on the input options.
pub struct ToCssResult {
    /// Serialized CSS code.
    pub code: Vec<u8>,
    /// A map of CSS module exports, if the `css_modules` option was enabled
    /// during parsing.
    pub exports: Option<CssModuleExports>,
    /// A map of CSS module references, if the `css_modules` config had
    /// `dashed_idents` enabled.
    pub references: Option<CssModuleReferences>,
    /// A list of dependencies (e.g. `@import` or `url()`) found in the style
    /// sheet, if the `analyze_dependencies` option is enabled.
    pub dependencies: Option<Vec<Dependency>>,
}

pub struct ToCssResultInternal {
    pub exports: Option<CssModuleExports>,
    pub references: Option<CssModuleReferences>,
    pub dependencies: Option<Vec<Dependency>>,
}

pub struct MinifyOptions {
    /// Targets to compile the CSS for.
    pub targets: targets::Targets,
    /// A list of known unused symbols, including CSS class names, ids, and
    /// `@keyframe` names. The declarations of these will be removed.
    pub unused_symbols: ArrayHashMap<Box<[u8]>, ()>,
}

impl Default for MinifyOptions {
    fn default() -> Self {
        Self { targets: targets::Targets::default(), unused_symbols: ArrayHashMap::default() }
    }
}

pub type BundlerStyleSheet = StyleSheet<BundlerAtRule>;
pub type BundlerCssRuleList = CssRuleList<BundlerAtRule>;
pub type BundlerCssRule = CssRule<BundlerAtRule>;
pub type BundlerLayerBlockRule = css_rules::layer::LayerBlockRule<BundlerAtRule>;
pub type BundlerSupportsRule = css_rules::supports::SupportsRule<BundlerAtRule>;
pub type BundlerMediaRule = css_rules::media::MediaRule<BundlerAtRule>;
pub type BundlerPrintResult = css_printer::PrintResult<BundlerAtRule>;

pub struct BundlerTailwindState {
    pub source: Box<[u8]>,
    pub index: bun_bundler::v2::Index,
    pub output_from_tailwind: Option<Box<[u8]>>,
}

/// Additional data we don't want stored on the stylesheet
#[derive(Default)]
pub struct StylesheetExtra {
    /// Used when css modules is enabled
    pub symbols: SymbolList,
}

pub struct ParserExtra {
    pub symbols: SymbolList,
    pub local_scope: LocalScope,
    pub source_index: SrcIndex,
}

/// Reference to a symbol in a stylesheet.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub struct CssRef(pub u32);

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq, Default)]
    pub struct CssRefTag: u8 {
        const CLASS         = 0b00_0001;
        const ID            = 0b00_0010;
        const ANIMATION     = 0b00_0100;
        const KEYFRAMES     = 0b00_1000;
        const CONTAINER     = 0b01_0000;
        const COUNTER_STYLE = 0b10_0000;
    }
}

impl CssRefTag {
    pub fn can_be_composed(self) -> bool {
        self.contains(CssRefTag::CLASS)
    }
}

impl CssRef {
    const INNER_INDEX_BITS: u32 = 26;
    const INNER_INDEX_MASK: u32 = (1 << Self::INNER_INDEX_BITS) - 1;

    pub fn new(inner_index: u32, tag: CssRefTag) -> Self {
        debug_assert!(inner_index <= Self::INNER_INDEX_MASK);
        Self(inner_index | ((tag.bits() as u32) << Self::INNER_INDEX_BITS))
    }

    pub fn inner_index(self) -> u32 {
        self.0 & Self::INNER_INDEX_MASK
    }

    pub fn tag(self) -> CssRefTag {
        CssRefTag::from_bits_retain((self.0 >> Self::INNER_INDEX_BITS) as u8)
    }

    pub fn set_tag(&mut self, tag: CssRefTag) {
        self.0 = self.inner_index() | ((tag.bits() as u32) << Self::INNER_INDEX_BITS);
    }

    pub fn can_be_composed(self) -> bool {
        self.tag().can_be_composed()
    }

    pub fn source_index(self, source_index: u32) -> u32 {
        source_index
    }

    pub fn to_real_ref(self, source_index: u32) -> bun_bundler::v2::Ref {
        bun_bundler::v2::Ref {
            inner_index: self.inner_index(),
            source_index: u32::try_from(source_index).unwrap(),
            tag: bun_bundler::v2::RefTag::Symbol,
        }
    }
}

pub struct LocalEntry {
    pub ref_: CssRef,
    pub loc: logger::Loc,
}

/// If css modules is enabled, this maps locally scoped class names to their
/// ref. We use this ref as a layer of indirection during the bundling stage
/// because we don't know the final generated class names for local scope
/// until print time.
pub type LocalScope = ArrayHashMap<Box<[u8]>, LocalEntry>;
/// Local symbol renaming results go here
pub type LocalsResultsMap = bun_bundler::v2::MangledProps;
/// Using `compose` and having conflicting properties is undefined behavior
/// according to the css modules spec. We should warn the user about this.
pub type LocalPropertyUsage = ArrayHashMap<bun_bundler::v2::Ref, PropertyUsage>;
pub type ComposesMap = ArrayHashMap<bun_bundler::v2::Ref, ComposesEntry>;

#[derive(Default)]
pub struct ComposesEntry {
    pub composes: BabyList<Composes>,
}

#[derive(Default)]
pub struct PropertyUsage {
    pub bitset: PropertyBitset,
    pub custom_properties: Box<[&'static [u8]]>, // TODO(port): lifetime — arena slices
    pub range: logger::Range,
}

impl PropertyUsage {
    #[inline]
    pub fn fill(&mut self, used: &PropertyBitset, custom_properties: &[&[u8]]) {
        self.bitset |= *used;
        // TODO(port): lifetime — Zig stored borrowed slice; box for now.
        self.custom_properties = custom_properties.to_vec().into_boxed_slice();
    }
}

// TODO(port): Zig: `std.bit_set.ArrayBitSet(usize, ceilPow2(EnumFields(PropertyIdTag).len))`.
// Phase B computes the variant count via `strum::EnumCount`.
pub type PropertyBitset = StaticBitSet<{ 1024 }>;

pub fn fill_property_bit_set(
    bitset: &mut PropertyBitset,
    block: &DeclarationBlock,
    custom_properties: &mut BabyList<&[u8]>,
) {
    for prop in block.declarations.iter() {
        let tag = match prop {
            Property::Custom(c) => {
                custom_properties.push(c.name.as_str());
                continue;
            }
            Property::Unparsed(u) => PropertyIdTag::from(&u.property_id),
            Property::Composes(_) => continue,
            _ => PropertyIdTag::from(prop),
        };
        let int: u16 = tag as u16;
        bitset.set(int as usize);
    }
    for prop in block.important_declarations.iter() {
        let tag = match prop {
            Property::Custom(c) => {
                custom_properties.push(c.name.as_str());
                continue;
            }
            Property::Unparsed(u) => PropertyIdTag::from(&u.property_id),
            Property::Composes(_) => continue,
            _ => PropertyIdTag::from(prop),
        };
        let int: u16 = tag as u16;
        bitset.set(int as usize);
    }
}

// ───────────────────────────── StyleSheet ─────────────────────────────

pub struct StyleSheet<AtRule> {
    /// A list of top-level rules within the style sheet.
    pub rules: CssRuleList<AtRule>,
    // PERF(port): was arena bulk-free — profile in Phase B (sources /
    // source_map_urls / license_comments were ArrayList fed input.allocator()).
    pub sources: Vec<Box<[u8]>>,
    pub source_map_urls: Vec<Option<Box<[u8]>>>,
    pub license_comments: Vec<&'static [u8]>, // TODO(port): lifetime — arena
    pub options: ParserOptions<'static>,       // TODO(port): lifetime
    // Zig: `tailwind: if (AtRule == BundlerAtRule) ?*BundlerTailwindState else u0`
    // TODO(port): conditional field; for now Option<Box<_>> always.
    pub tailwind: Option<Box<BundlerTailwindState>>,
    pub layer_names: BabyList<LayerName>,

    /// Used when css modules is enabled. Maps `local name string` -> `Ref`.
    pub local_scope: LocalScope,
    /// Used when css modules is enabled. Track which properties are used in
    /// local scope.
    pub local_properties: LocalPropertyUsage,
    /// Used when css modules is enabled.
    pub composes: ComposesMap,
}

impl<AtRule> StyleSheet<AtRule> {
    pub fn empty() -> Self {
        Self {
            rules: CssRuleList::default(),
            sources: Vec::new(),
            source_map_urls: Vec::new(),
            license_comments: Vec::new(),
            options: ParserOptions::default(None),
            tailwind: None,
            layer_names: BabyList::default(),
            local_scope: LocalScope::default(),
            local_properties: LocalPropertyUsage::default(),
            composes: ComposesMap::default(),
        }
    }

    /// Minify and transform the style sheet for the provided browser targets.
    pub fn minify(
        &mut self,
        options: &MinifyOptions,
        extra: &StylesheetExtra,
    ) -> Maybe<(), Err<MinifyErrorKind>> {
        let ctx = PropertyHandlerContext::new(options.targets, &options.unused_symbols);
        let mut handler = DeclarationHandler::default();
        let mut important_handler = DeclarationHandler::default();

        // @custom-media rules may be defined after they are referenced, but
        // may only be defined at the top level of a stylesheet. Do a pre-scan
        // here and create a lookup table by name.
        let custom_media: Option<ArrayHashMap<Box<[u8]>, css_rules::custom_media::CustomMediaRule>> =
            if self.options.flags.contains(ParserFlags::CUSTOM_MEDIA)
                && options.targets.should_compile_same(Features::CUSTOM_MEDIA_QUERIES)
            {
                let mut custom_media = ArrayHashMap::default();
                for rule in self.rules.v.iter() {
                    if let CssRule::CustomMedia(cm) = rule {
                        custom_media.insert(cm.name.v.into(), cm.deep_clone());
                    }
                }
                Some(custom_media)
            } else {
                None
            };

        let mut minify_ctx = MinifyContext {
            targets: &options.targets,
            handler: &mut handler,
            important_handler: &mut important_handler,
            handler_context: ctx,
            unused_symbols: &options.unused_symbols,
            custom_media,
            css_modules: self.options.css_modules.is_some(),
            extra,
        };

        if self.rules.minify(&mut minify_ctx, false).is_err() {
            panic!("TODO: Handle");
        }

        Ok(())
    }

    pub fn to_css_with_writer(
        &self,
        writer: &mut dyn bun_io::Write,
        options: PrinterOptions,
        import_info: Option<ImportInfo>,
        local_names: Option<&LocalsResultsMap>,
        symbols: &bun_js_parser::ast::symbol::Map,
    ) -> PrintResult<ToCssResultInternal> {
        let mut printer = Printer::new(Vec::new(), writer, options, import_info, local_names, symbols);
        match self.to_css_with_writer_impl(&mut printer, options) {
            Ok(result) => Ok(result),
            Err(_) => {
                debug_assert!(printer.error_kind.is_some());
                Err(printer.error_kind.unwrap())
            }
        }
    }

    pub fn to_css_with_writer_impl(
        &self,
        printer: &mut Printer,
        options: PrinterOptions,
    ) -> Result<ToCssResultInternal, PrintErr> {
        let project_root = options.project_root;

        // #[cfg(feature = "sourcemap")] { printer.sources = Some(&self.sources); }
        // #[cfg(feature = "sourcemap")] if printer.source_map.is_some() { ... }

        for comment in &self.license_comments {
            printer.write_str("/*")?;
            printer.write_comment(comment)?;
            printer.write_str("*/")?;
            printer.newline()?;
        }

        if let Some(config) = &self.options.css_modules {
            let mut references = CssModuleReferences::default();
            printer.css_module = Some(CssModule::new(config, &self.sources, project_root, &mut references));

            self.rules.to_css(printer)?;
            printer.newline()?;

            Ok(ToCssResultInternal {
                dependencies: printer.dependencies.take(),
                exports: {
                    let val = core::mem::take(
                        &mut printer.css_module.as_mut().unwrap().exports_by_source_index[0],
                    );
                    Some(val)
                },
                references: Some(references),
            })
        } else {
            self.rules.to_css(printer)?;
            printer.newline()?;
            Ok(ToCssResultInternal {
                dependencies: printer.dependencies.take(),
                exports: None,
                references: None,
            })
        }
    }

    pub fn to_css(
        &self,
        options: PrinterOptions,
        import_info: Option<ImportInfo>,
        local_names: Option<&LocalsResultsMap>,
        symbols: &bun_js_parser::ast::symbol::Map,
    ) -> PrintResult<ToCssResult> {
        // TODO: this is not necessary
        // Make sure we always have capacity > 0: https://github.com/napi-rs/napi-rs/issues/1124.
        let mut dest: Vec<u8> = Vec::with_capacity(1);
        // TODO(port): writer adapter — Zig used std.Io.Writer.Allocating.
        let result = self.to_css_with_writer(&mut dest, options, import_info, local_names, symbols)?;
        Ok(ToCssResult {
            code: dest,
            dependencies: result.dependencies,
            exports: result.exports,
            references: result.references,
        })
    }

    pub fn parse(
        code: &[u8],
        options: ParserOptions,
        import_records: Option<&mut BabyList<ImportRecord>>,
        source_index: SrcIndex,
    ) -> Maybe<(Self, StylesheetExtra), Err<ParserError>> {
        let mut default_at_rule_parser = DefaultAtRuleParser;
        Self::parse_with(code, options, &mut default_at_rule_parser, import_records, source_index)
    }

    pub fn parse_bundler(
        code: &[u8],
        options: ParserOptions,
        import_records: &mut BabyList<ImportRecord>,
        source_index: SrcIndex,
    ) -> Maybe<(Self, StylesheetExtra), Err<ParserError>> {
        let mut at_rule_parser = BundlerAtRuleParser {
            import_records,
            options: &options,
            layer_names: BabyList::default(),
            anon_layer_count: 0,
            enclosing_layer: LayerName::default(),
        };
        // TODO(port): borrowck — `import_records` is borrowed mutably twice
        // (once in BundlerAtRuleParser, once passed to parse_with). Zig
        // aliased; Phase B reshapes.
        Self::parse_with(code, options, &mut at_rule_parser, Some(import_records), source_index)
    }

    /// Parse a style sheet from a string.
    pub fn parse_with<P: CustomAtRuleParser>(
        code: &[u8],
        options: ParserOptions,
        at_rule_parser: &mut P,
        import_records: Option<&mut BabyList<ImportRecord>>,
        source_index: SrcIndex,
    ) -> Maybe<(Self, StylesheetExtra), Err<ParserError>>
    where
        AtRule: From<P::AtRule>, // TODO(port): Zig instantiates StyleSheet(AtRule) generically
    {
        let mut composes = ComposesMap::default();
        let mut parser_extra = ParserExtra {
            local_scope: LocalScope::default(),
            symbols: SymbolList::default(),
            source_index,
        };
        let mut local_properties = LocalPropertyUsage::default();

        let mut input = ParserInput::new(code);
        let mut parser = Parser::new(
            &mut input,
            import_records,
            ParserOpts { css_modules: options.css_modules.is_some(), ..Default::default() },
            Some(&mut parser_extra),
        );

        // PERF(port): was arena bulk-free — profile in Phase B
        let mut license_comments: Vec<&[u8]> = Vec::new();
        let mut state = parser.state();
        while let Ok(token) = parser.next_including_whitespace_and_comments() {
            match token {
                Token::Whitespace(_) => {}
                Token::Comment(comment) => {
                    if comment.first() == Some(&b'!') {
                        license_comments.push(comment);
                    }
                }
                _ => break,
            }
            state = parser.state();
        }
        parser.reset(&state);

        let mut rules = CssRuleList::<AtRule>::default();
        let mut rule_parser = TopLevelRuleParser::new(
            &options,
            at_rule_parser,
            &mut rules,
            &mut composes,
            &mut local_properties,
        );
        let mut rule_list_parser = StyleSheetParser::new(&mut parser, &mut rule_parser);

        while let Some(result) = rule_list_parser.next() {
            if let Err(e) = result {
                let result_options = rule_list_parser.parser.options;
                if result_options.error_recovery {
                    // todo_stuff.warn
                    continue;
                }
                return Err(Err::from_parse_error(e, options.filename));
            }
        }

        let mut sources = Vec::with_capacity(1);
        sources.push(options.filename.into());
        let mut source_map_urls = Vec::with_capacity(1);
        source_map_urls.push(parser.current_source_map_url().map(Into::into));

        // TODO(port): `layer_names` is taken from `at_rule_parser` only when
        // `P == BundlerAtRuleParser`. Rust cannot specialize at runtime; Phase
        // B adds a `take_layer_names()` method on `CustomAtRuleParser`.
        let layer_names = BabyList::default();

        Ok((
            Self {
                rules,
                sources,
                source_map_urls,
                license_comments,
                options,
                tailwind: None,
                layer_names,
                local_scope: parser_extra.local_scope,
                local_properties,
                composes,
            },
            StylesheetExtra { symbols: parser_extra.symbols },
        ))
    }

    pub fn debug_layer_rule_sanity_check(&self) {
        if !cfg!(debug_assertions) {
            return;
        }
        let _layer_names_field_len = self.layer_names.len();
        let mut actual_layer_rules_len: usize = 0;
        for rule in self.rules.v.iter() {
            if matches!(rule, CssRule::LayerBlock(_)) {
                actual_layer_rules_len += 1;
            }
        }
        // bun.debugAssert()
    }

    pub fn contains_tailwind_directives(&self) -> bool {
        // TODO(port): Zig `@compileError` if AtRule != BundlerAtRule.
        let mut found_import = false;
        for rule in self.rules.v.iter() {
            match rule {
                CssRule::Custom(_) => return true,
                // TODO: layer
                CssRule::LayerBlock(_) => {}
                CssRule::Import(_) => {
                    found_import = true;
                }
                _ => return false,
            }
        }
        let _ = found_import;
        false
    }

    pub fn new_from_tailwind_imports(
        options: ParserOptions<'static>,
        imports_from_tailwind: CssRuleList<AtRule>,
    ) -> Self {
        Self {
            rules: imports_from_tailwind,
            sources: Vec::new(),
            source_map_urls: Vec::new(),
            license_comments: Vec::new(),
            options,
            tailwind: None,
            layer_names: BabyList::default(),
            local_scope: LocalScope::default(),
            local_properties: LocalPropertyUsage::default(),
            composes: ComposesMap::default(),
        }
    }

    /// *NOTE*: Used for Tailwind stylesheets only.
    ///
    /// This plucks out the import rules from the Tailwind stylesheet into a
    /// separate rule list, replacing them with `.ignored` rules.
    pub fn pluck_imports(
        &self,
        out: &mut CssRuleList<AtRule>,
        new_import_records: &mut BabyList<ImportRecord>,
    ) {
        // Zig used a comptime two-pass `inline for` (count, exec). Unroll.
        let mut count: u32 = 0;
        {
            let mut saw_imports = false;
            for rule in self.rules.v.iter() {
                match rule {
                    CssRule::LayerBlock(_) => {}
                    CssRule::Import(_) => {
                        if !saw_imports {
                            saw_imports = true;
                        }
                        count += 1;
                    }
                    CssRule::Unknown(u) => {
                        if u.name == b"tailwind" {
                            continue;
                        }
                    }
                    _ => {}
                }
                if saw_imports {
                    break;
                }
            }
        }
        out.v.reserve(count as usize);
        // TODO(port): the Zig fn takes `*const @This()` but mutates
        // `rule.* = .ignored;` — that's `&mut self` in Rust. Phase B reshapes.
        let mut saw_imports = false;
        // SAFETY: Phase A draft — Zig mutated through const ptr.
        let rules_mut = unsafe {
            &mut *(self.rules.v.as_ptr() as *mut Vec<CssRule<AtRule>>)
        };
        for rule in rules_mut.iter_mut() {
            match rule {
                CssRule::LayerBlock(_) => {}
                CssRule::Import(import_rule) => {
                    if !saw_imports {
                        saw_imports = true;
                    }
                    out.v.push(rule.clone());
                    // PERF(port): was appendAssumeCapacity
                    let import_record_idx = new_import_records.len();
                    import_rule.import_record_idx = import_record_idx;
                    new_import_records.push(ImportRecord {
                        path: bun_fs::Path::init(import_rule.url),
                        kind: if import_rule.supports.is_some() {
                            ImportKind::AtConditional
                        } else {
                            ImportKind::At
                        },
                        range: logger::Range::NONE,
                        ..Default::default()
                    });
                    *rule = CssRule::Ignored;
                }
                CssRule::Unknown(u) => {
                    if u.name == b"tailwind" {
                        continue;
                    }
                }
                _ => {}
            }
            if saw_imports {
                break;
            }
        }
    }
}

// ───────────────────────────── StyleAttribute ─────────────────────────────

pub struct StyleAttribute {
    pub declarations: DeclarationBlock,
    pub sources: Vec<Box<[u8]>>,
}

impl StyleAttribute {
    pub fn parse(
        code: &[u8],
        options: ParserOptions,
        import_records: &mut BabyList<ImportRecord>,
        source_index: SrcIndex,
    ) -> Maybe<StyleAttribute, Err<ParserError>> {
        let mut parser_extra = ParserExtra {
            local_scope: LocalScope::default(),
            symbols: SymbolList::default(),
            source_index,
        };
        let mut input = ParserInput::new(code);
        let mut parser = Parser::new(
            &mut input,
            Some(import_records),
            ParserOpts { css_modules: options.css_modules.is_some(), ..Default::default() },
            Some(&mut parser_extra),
        );
        let mut sources = Vec::with_capacity(1);
        sources.push(options.filename.into());
        // PERF(port): was appendAssumeCapacity
        Ok(StyleAttribute {
            declarations: match DeclarationBlock::parse(&mut parser, &options) {
                Ok(v) => v,
                Err(e) => return Err(Err::from_parse_error(e, b"")),
            },
            sources,
        })
    }

    pub fn to_css(
        &self,
        options: PrinterOptions,
        import_info: Option<ImportInfo>,
    ) -> Result<ToCssResult, PrintErr> {
        // #[cfg(feature = "sourcemap")] assert!(options.source_map.is_none(), ...);

        let symbols = bun_js_parser::ast::symbol::Map::default();
        let mut dest: Vec<u8> = Vec::new();
        // TODO(port): writer adapter
        let mut printer = Printer::new(Vec::new(), &mut dest, options, import_info, None, &symbols);
        printer.sources = Some(&self.sources);

        self.declarations.to_css(&mut printer)?;

        Ok(ToCssResult {
            dependencies: printer.dependencies.take(),
            code: dest,
            exports: None,
            references: None,
        })
    }

    pub fn minify(&mut self, _options: MinifyOptions) {
        // TODO: IMPLEMENT THIS!
    }
}

// ───────────────────────────── RuleBodyParser ─────────────────────────────

pub struct RuleBodyParser<'a, P: RuleBodyItemParser> {
    pub input: &'a mut Parser<'a>,
    pub parser: &'a mut P,
}

impl<'a, P> RuleBodyParser<'a, P>
where
    P: RuleBodyItemParser<
        Declaration = <P as QualifiedRuleParser>::QualifiedRule,
        AtRule = <P as QualifiedRuleParser>::QualifiedRule,
    >,
{
    pub fn new(input: &'a mut Parser<'a>, parser: &'a mut P) -> Self {
        Self { input, parser }
    }

    /// TODO: result is actually `Result<I, (ParseError, &str)>` but nowhere
    /// in the source do I actually see it using the string part of the tuple.
    pub fn next(&mut self) -> Option<CssResult<<P as QualifiedRuleParser>::QualifiedRule>> {
        type I<P> = <P as QualifiedRuleParser>::QualifiedRule;
        loop {
            self.input.skip_whitespace();
            let start = self.input.state();

            let tok: &Token = match self.input.next_including_whitespace_and_comments() {
                Err(_) => return None,
                Ok(vvv) => vvv,
            };

            match tok {
                Token::CloseCurly | Token::Whitespace(_) | Token::Semicolon | Token::Comment(_) => {
                    continue;
                }
                Token::AtKeyword(name) => {
                    let name = *name;
                    return Some(parse_at_rule(&start, name, self.input, self.parser));
                }
                Token::Ident(name) => {
                    if P::parse_declarations(self.parser) {
                        let name = *name;
                        let parse_qualified = P::parse_qualified(self.parser);
                        let result: CssResult<I<P>> = {
                            let error_behavior = if parse_qualified {
                                ParseUntilErrorBehavior::Stop
                            } else {
                                ParseUntilErrorBehavior::Consume
                            };
                            parse_until_after(
                                self.input,
                                Delimiters::SEMICOLON,
                                error_behavior,
                                (self.parser as *mut P, name),
                                |(parser, name), input| {
                                    input.expect_colon()?;
                                    // SAFETY: parser outlives this closure
                                    let parser = unsafe { &mut *parser };
                                    P::parse_value(parser, name, input)
                                },
                            )
                        };
                        if result.is_err() && parse_qualified {
                            self.input.reset(&start);
                            if let Ok(qual) = parse_qualified_rule(
                                &start,
                                self.input,
                                self.parser,
                                Delimiters::SEMICOLON | Delimiters::CURLY_BRACKET,
                            ) {
                                return Some(Ok(qual));
                            }
                        }
                        return Some(result);
                    }
                }
                _ => {}
            }

            let result: CssResult<I<P>> = if P::parse_qualified(self.parser) {
                self.input.reset(&start);
                let delimiters = if P::parse_declarations(self.parser) {
                    Delimiters::SEMICOLON | Delimiters::CURLY_BRACKET
                } else {
                    Delimiters::CURLY_BRACKET
                };
                parse_qualified_rule(&start, self.input, self.parser, delimiters)
            } else {
                let token = tok.clone();
                let start_clone = start.clone();
                self.input.parse_until_after(Delimiters::SEMICOLON, move |_i| {
                    Err(start_clone.source_location().new_unexpected_token_error(token))
                })
            };

            return Some(result);
        }
    }
}

// ───────────────────────────── ParserOptions ─────────────────────────────

pub struct ParserOptions<'a> {
    /// Filename to use in error messages.
    pub filename: &'static [u8], // TODO(port): lifetime
    /// Whether to enable [CSS modules](https://github.com/css-modules/css-modules).
    pub css_modules: Option<css_modules::Config>,
    /// The source index to assign to all parsed rules. Impacts the source map
    /// when the style sheet is serialized.
    pub source_index: u32,
    /// Whether to ignore invalid rules and declarations rather than erroring.
    pub error_recovery: bool,
    /// A list that will be appended to when a warning occurs.
    pub logger: Option<&'a mut Log>,
    /// Feature flags to enable.
    pub flags: ParserFlags,
}

impl<'a> ParserOptions<'a> {
    pub fn warn(&self, warning: ParseError<ParserError>) {
        if let Some(lg) = &self.logger {
            // TODO(port): &mut Log behind &self — Zig mutated through *Log.
            // Phase B: store `*mut Log` or interior-mutable Log.
            // SAFETY: logger is Option<&'a mut Log>; we hold the only borrow and
            // Zig mutated through *Log. No other &Log alias exists for the
            // duration of this call.
            let lg: &mut Log = unsafe { &mut *(*lg as *const Log as *mut Log) };
            lg.add_warning_fmt_line_col(
                self.filename,
                warning.location.line,
                warning.location.column,
                format_args!("{}", warning.kind),
            )
            .expect("unreachable");
        }
    }

    pub fn warn_fmt(&self, args: fmt::Arguments<'_>, line: u32, column: u32) {
        if let Some(lg) = &self.logger {
            // SAFETY: logger is Option<&'a mut Log>; we hold the only borrow and
            // Zig mutated through *Log.
            let lg: &mut Log = unsafe { &mut *(*lg as *const Log as *mut Log) };
            lg.add_warning_fmt_line_col(self.filename, line, column, args)
                .expect("unreachable");
        }
    }

    pub fn warn_fmt_with_notes(
        &self,
        args: fmt::Arguments<'_>,
        line: u32,
        column: u32,
        notes: &mut [logger::Data],
    ) {
        if let Some(lg) = &self.logger {
            // SAFETY: logger is Option<&'a mut Log>; we hold the only borrow and
            // Zig mutated through *Log.
            let lg: &mut Log = unsafe { &mut *(*lg as *const Log as *mut Log) };
            lg.add_warning_fmt_line_col_with_notes(self.filename, line, column, args, notes)
                .expect("unreachable");
        }
    }

    pub fn warn_fmt_with_note(
        &self,
        args: fmt::Arguments<'_>,
        line: u32,
        column: u32,
        note_args: fmt::Arguments<'_>,
        note_range: logger::Range,
    ) {
        if let Some(lg) = &self.logger {
            // SAFETY: logger is Option<&'a mut Log>; we hold the only borrow and
            // Zig mutated through *Log.
            let lg: &mut Log = unsafe { &mut *(*lg as *const Log as *mut Log) };
            lg.add_range_warning_fmt_with_note(
                None,
                logger::Loc { start: i32::try_from(line).unwrap() },
                // TODO(port): Zig wrote `.end = column` on Loc; Loc has no .end field.
                args,
                note_args,
                note_range,
            )
            .expect("unreachable");
        }
        let _ = column;
    }

    pub fn default(log: Option<&'a mut Log>) -> ParserOptions<'a> {
        ParserOptions {
            filename: b"",
            css_modules: None,
            source_index: 0,
            error_recovery: false,
            logger: log,
            flags: ParserFlags::default(),
        }
    }
}

bitflags::bitflags! {
    /// Parser feature flags to enable.
    #[derive(Clone, Copy, PartialEq, Eq, Default)]
    pub struct ParserFlags: u8 {
        /// Whether to enable the [CSS nesting](https://www.w3.org/TR/css-nesting-1/) draft syntax.
        const NESTING = 0b001;
        /// Whether to enable the [custom media](https://drafts.csswg.org/mediaqueries-5/#custom-mq) draft syntax.
        const CUSTOM_MEDIA = 0b010;
        /// Whether to enable the non-standard >>> and /deep/ selector combinators used by Vue and Angular.
        const DEEP_SELECTOR_COMBINATOR = 0b100;
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ParseUntilErrorBehavior {
    Consume,
    Stop,
}

// ───────────────────────────── Parser ─────────────────────────────

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq, Default)]
    pub struct ParserOpts: u8 {
        const CSS_MODULES = 0b1;
    }
}
// PORT NOTE: Zig packed struct had `css_modules: bool`. Expose accessor:
impl ParserOpts {
    #[inline]
    pub fn css_modules(self) -> bool {
        self.contains(Self::CSS_MODULES)
    }
}

pub struct Parser<'a> {
    pub input: &'a mut ParserInput<'a>,
    pub at_start_of: Option<BlockType>,
    pub stop_before: Delimiters,
    pub flags: ParserOpts,
    pub import_records: Option<&'a mut BabyList<ImportRecord>>,
    pub extra: Option<&'a mut ParserExtra>,
}

impl<'a> Parser<'a> {
    pub fn add_symbol_for_name(
        &mut self,
        name: &[u8],
        tag: CssRefTag,
        loc: logger::Loc,
    ) -> bun_bundler::v2::Ref {
        // don't call this if css modules is not enabled!
        debug_assert!(self.flags.css_modules());
        debug_assert!(self.extra.is_some());
        if cfg!(debug_assertions) {
            // tag should only have one bit set, or none
            debug_assert!(tag.bits().count_ones() <= 1);
        }

        let extra = self.extra.as_mut().unwrap();

        // TODO(port): `getOrPut` — ArrayHashMap entry API.
        let entry = extra.local_scope.entry(name.into());
        let entry = entry.or_insert_with(|| {
            let inner_index = u32::try_from(extra.symbols.len()).unwrap();
            extra.symbols.push(bun_js_parser::ast::Symbol {
                kind: bun_js_parser::ast::SymbolKind::LocalCss,
                original_name: name.into(),
                ..Default::default()
            });
            LocalEntry { ref_: CssRef::new(inner_index, tag), loc }
        });
        // If existing:
        let prev_tag = entry.ref_.tag();
        if !prev_tag.contains(CssRefTag::CLASS) && tag.contains(CssRefTag::CLASS) {
            entry.loc = loc;
            entry.ref_.set_tag(prev_tag | tag);
        }

        entry.ref_.to_real_ref(extra.source_index.get())
    }

    // TODO: dedupe import records??
    pub fn add_import_record(
        &mut self,
        url: &[u8],
        start_position: usize,
        kind: ImportKind,
    ) -> CssResult<u32> {
        if let Some(import_records) = &mut self.import_records {
            let idx = import_records.len();
            import_records.push(ImportRecord {
                path: bun_fs::Path::init(url),
                kind,
                range: logger::Range {
                    loc: logger::Loc { start: i32::try_from(start_position).unwrap() },
                    // TODO: technically this is not correct because the url could be escaped
                    len: i32::try_from(url.len()).unwrap(),
                },
                ..Default::default()
            });
            Ok(idx)
        } else {
            Err(self.new_basic_unexpected_token_error(Token::UnquotedUrl(url)))
        }
    }

    #[inline]
    pub fn allocator(&self) -> &Bump {
        self.input.tokenizer.allocator
    }

    /// Create a new Parser.
    ///
    /// Pass in `import_records` to track imports (`@import` rules, `url()`
    /// tokens). If this is `None`, calling `Parser::add_import_record` will
    /// error.
    pub fn new(
        input: &'a mut ParserInput<'a>,
        import_records: Option<&'a mut BabyList<ImportRecord>>,
        flags: ParserOpts,
        extra: Option<&'a mut ParserExtra>,
    ) -> Parser<'a> {
        Parser {
            input,
            at_start_of: None,
            stop_before: Delimiters::NONE,
            flags,
            import_records,
            extra,
        }
    }

    pub fn new_custom_error(&self, err: ParserError) -> ParseError<ParserError> {
        self.current_source_location().new_custom_error(err)
    }

    pub fn new_basic_error(&self, kind: BasicParseErrorKind) -> BasicParseError {
        BasicParseError { kind, location: self.current_source_location() }
    }

    pub fn new_error(&self, kind: BasicParseErrorKind) -> ParseError<ParserError> {
        ParseError {
            kind: errors_::ParseErrorKind::Basic(kind),
            location: self.current_source_location(),
        }
    }

    pub fn new_unexpected_token_error(&self, token: Token) -> ParseError<ParserError> {
        self.new_error(BasicParseErrorKind::UnexpectedToken(token))
    }

    pub fn new_basic_unexpected_token_error(&self, token: Token) -> ParseError<ParserError> {
        self.new_basic_error(BasicParseErrorKind::UnexpectedToken(token))
            .into_default_parse_error()
    }

    pub fn current_source_location(&self) -> SourceLocation {
        self.input.tokenizer.current_source_location()
    }

    pub fn current_source_map_url(&self) -> Option<&[u8]> {
        self.input.tokenizer.current_source_map_url()
    }

    /// Return a slice of the CSS input, from the given position to the current one.
    pub fn slice_from(&self, start_position: usize) -> &[u8] {
        self.input.tokenizer.slice_from(start_position)
    }

    /// Implementation of `Vec<T>::parse`
    pub fn parse_list<T>(
        &mut self,
        parse_one: impl Fn(&mut Parser) -> CssResult<T>,
    ) -> CssResult<Vec<T>> {
        self.parse_comma_separated(parse_one)
    }

    /// Parse a list of comma-separated values, all with the same syntax.
    pub fn parse_comma_separated<T>(
        &mut self,
        parse_one: impl Fn(&mut Parser) -> CssResult<T>,
    ) -> CssResult<Vec<T>> {
        self.parse_comma_separated_internal(|(), p| parse_one(p), false)
    }

    pub fn parse_comma_separated_with_ctx<T, C>(
        &mut self,
        closure: C,
        parse_one: impl Fn(&mut C, &mut Parser) -> CssResult<T>,
    ) -> CssResult<Vec<T>> {
        let mut closure = closure;
        self.parse_comma_separated_internal(move |(), p| parse_one(&mut closure, p), false)
    }

    fn parse_comma_separated_internal<T>(
        &mut self,
        mut parse_one: impl FnMut((), &mut Parser) -> CssResult<T>,
        ignore_errors: bool,
    ) -> CssResult<Vec<T>> {
        // Vec grows from 0 to 4 by default on first push().  So allocate with
        // capacity 1, so in the somewhat common case of only one item we don't
        // way overallocate.  Note that we always push at least one item if
        // parsing succeeds.
        // PERF(port): was stack-fallback
        let mut values: Vec<T> = Vec::with_capacity(1);

        loop {
            self.skip_whitespace(); // Unnecessary for correctness, but may help try() rewind less.
            match self.parse_until_before(Delimiters::COMMA, |p| parse_one((), p)) {
                Ok(v) => values.push(v),
                Err(e) => {
                    if !ignore_errors {
                        return Err(e);
                    }
                }
            }

            let tok = match self.next() {
                Ok(v) => v,
                Err(_) => return Ok(values),
            };
            if !matches!(tok, Token::Comma) {
                unreachable!();
            }
        }
    }

    /// Execute the given closure, passing it the parser. If the result is
    /// `Err`, the internal state of the parser is restored to what it was
    /// before the call.
    #[inline]
    pub fn try_parse<R>(
        &mut self,
        func: impl FnOnce(&mut Parser) -> CssResult<R>,
    ) -> CssResult<R> {
        let start = self.state();
        let result = func(self);
        if result.is_err() {
            self.reset(&start);
        }
        result
    }

    // Zig `tryParseImpl` is the same as `tryParse` with manual args tuple;
    // collapsed into `try_parse`.

    #[inline]
    pub fn parse_nested_block<T>(
        &mut self,
        parsefn: impl FnOnce(&mut Parser) -> CssResult<T>,
    ) -> CssResult<T> {
        parse_nested_block(self, parsefn)
    }

    pub fn is_exhausted(&mut self) -> bool {
        self.expect_exhausted().is_ok()
    }

    /// Parse the input until exhaustion and check that it contains no "error"
    /// token. See `Token::is_parse_error`.
    pub fn expect_no_error_token(&mut self) -> CssResult<()> {
        loop {
            let tok = match self.next_including_whitespace_and_comments() {
                Err(_) => return Ok(()),
                Ok(v) => v,
            };
            match tok {
                Token::Function(_) | Token::OpenParen | Token::OpenSquare | Token::OpenCurly => {
                    self.parse_nested_block(|i| i.expect_no_error_token())?;
                    return Ok(());
                }
                _ => {
                    if tok.is_parse_error() {
                        let tok = tok.clone();
                        return Err(self.new_unexpected_token_error(tok));
                    }
                }
            }
        }
    }

    pub fn expect_percentage(&mut self) -> CssResult<f32> {
        let start_location = self.current_source_location();
        let tok = self.next()?;
        if let Token::Percentage { unit_value, .. } = tok {
            return Ok(*unit_value);
        }
        let tok = tok.clone();
        Err(start_location.new_unexpected_token_error(tok))
    }

    pub fn expect_comma(&mut self) -> CssResult<()> {
        let start_location = self.current_source_location();
        let tok = self.next()?;
        if matches!(tok, Token::Comma) {
            return Ok(());
        }
        let tok = tok.clone();
        Err(start_location.new_unexpected_token_error(tok))
    }

    /// Parse a `<number-token>` that does not have a fractional part, and
    /// return the integer value.
    pub fn expect_integer(&mut self) -> CssResult<i32> {
        let start_location = self.current_source_location();
        let tok = self.next()?;
        if let Token::Number(n) = tok {
            if let Some(iv) = n.int_value {
                return Ok(iv);
            }
        }
        let tok = tok.clone();
        Err(start_location.new_unexpected_token_error(tok))
    }

    /// Parse a `<number-token>` and return the float value.
    pub fn expect_number(&mut self) -> CssResult<f32> {
        let start_location = self.current_source_location();
        let tok = self.next()?;
        if let Token::Number(n) = tok {
            return Ok(n.value);
        }
        let tok = tok.clone();
        Err(start_location.new_unexpected_token_error(tok))
    }

    pub fn expect_delim(&mut self, delim: u8) -> CssResult<()> {
        let start_location = self.current_source_location();
        let tok = self.next()?;
        if let Token::Delim(d) = tok {
            if *d == delim as u32 {
                return Ok(());
            }
        }
        let tok = tok.clone();
        Err(start_location.new_unexpected_token_error(tok))
    }

    pub fn expect_parenthesis_block(&mut self) -> CssResult<()> {
        let start_location = self.current_source_location();
        let tok = self.next()?;
        if matches!(tok, Token::OpenParen) {
            return Ok(());
        }
        let tok = tok.clone();
        Err(start_location.new_unexpected_token_error(tok))
    }

    pub fn expect_colon(&mut self) -> CssResult<()> {
        let start_location = self.current_source_location();
        let tok = self.next()?;
        if matches!(tok, Token::Colon) {
            return Ok(());
        }
        let tok = tok.clone();
        Err(start_location.new_unexpected_token_error(tok))
    }

    pub fn expect_string(&mut self) -> CssResult<&[u8]> {
        let start_location = self.current_source_location();
        let tok = self.next()?;
        if let Token::QuotedString(s) = tok {
            return Ok(*s);
        }
        let tok = tok.clone();
        Err(start_location.new_unexpected_token_error(tok))
    }

    pub fn expect_ident(&mut self) -> CssResult<&[u8]> {
        let start_location = self.current_source_location();
        let tok = self.next()?;
        if let Token::Ident(s) = tok {
            return Ok(*s);
        }
        let tok = tok.clone();
        Err(start_location.new_unexpected_token_error(tok))
    }

    /// Parse either a `<ident-token>` or a `<string-token>`, and return the
    /// unescaped value.
    pub fn expect_ident_or_string(&mut self) -> CssResult<&[u8]> {
        let start_location = self.current_source_location();
        let tok = self.next()?;
        match tok {
            Token::Ident(i) => return Ok(*i),
            Token::QuotedString(s) => return Ok(*s),
            _ => {}
        }
        let tok = tok.clone();
        Err(start_location.new_unexpected_token_error(tok))
    }

    pub fn expect_ident_matching(&mut self, name: &[u8]) -> CssResult<()> {
        let start_location = self.current_source_location();
        let tok = self.next()?;
        if let Token::Ident(i) = tok {
            if strings::eql_case_insensitive_ascii_check_length(name, i) {
                return Ok(());
            }
        }
        let tok = tok.clone();
        Err(start_location.new_unexpected_token_error(tok))
    }

    pub fn expect_function(&mut self) -> CssResult<&[u8]> {
        let start_location = self.current_source_location();
        let tok = self.next()?;
        if let Token::Function(fn_name) = tok {
            return Ok(*fn_name);
        }
        let tok = tok.clone();
        Err(start_location.new_unexpected_token_error(tok))
    }

    pub fn expect_function_matching(&mut self, name: &[u8]) -> CssResult<()> {
        let start_location = self.current_source_location();
        let tok = self.next()?;
        if let Token::Function(fn_name) = tok {
            if strings::eql_case_insensitive_ascii_check_length(name, fn_name) {
                return Ok(());
            }
        }
        let tok = tok.clone();
        Err(start_location.new_unexpected_token_error(tok))
    }

    pub fn expect_curly_bracket_block(&mut self) -> CssResult<()> {
        let start_location = self.current_source_location();
        let tok = self.next()?;
        if matches!(tok, Token::OpenCurly) {
            return Ok(());
        }
        let tok = tok.clone();
        Err(start_location.new_unexpected_token_error(tok))
    }

    pub fn expect_square_bracket_block(&mut self) -> CssResult<()> {
        let start_location = self.current_source_location();
        let tok = self.next()?;
        if matches!(tok, Token::OpenSquare) {
            return Ok(());
        }
        let tok = tok.clone();
        Err(start_location.new_unexpected_token_error(tok))
    }

    /// Parse a `<url-token>` and return the unescaped value.
    pub fn expect_url(&mut self) -> CssResult<&[u8]> {
        let start_location = self.current_source_location();
        let tok = self.next()?;
        match tok {
            Token::UnquotedUrl(value) => return Ok(*value),
            Token::Function(name) => {
                if strings::eql_case_insensitive_ascii_check_length(b"url", name) {
                    return self.parse_nested_block(|parser| parser.expect_string());
                }
            }
            _ => {}
        }
        let tok = tok.clone();
        Err(start_location.new_unexpected_token_error(tok))
    }

    /// Parse either a `<url-token>` or a `<string-token>`, and return the
    /// unescaped value.
    pub fn expect_url_or_string(&mut self) -> CssResult<&[u8]> {
        let start_location = self.current_source_location();
        let tok = self.next()?;
        match tok {
            Token::UnquotedUrl(value) => return Ok(*value),
            Token::QuotedString(value) => return Ok(*value),
            Token::Function(name) => {
                if strings::eql_case_insensitive_ascii_check_length(b"url", name) {
                    return self.parse_nested_block(|parser| parser.expect_string());
                }
            }
            _ => {}
        }
        let tok = tok.clone();
        Err(start_location.new_unexpected_token_error(tok))
    }

    pub fn position(&self) -> usize {
        debug_assert!(strings::is_on_char_boundary(
            self.input.tokenizer.src,
            self.input.tokenizer.position
        ));
        self.input.tokenizer.position
    }

    fn parse_empty(_: &mut Parser) -> CssResult<()> {
        Ok(())
    }

    /// Like `parse_until_before`, but also consume the delimiter token.
    pub fn parse_until_after<T>(
        &mut self,
        delimiters: Delimiters,
        parse_fn: impl FnOnce(&mut Parser) -> CssResult<T>,
    ) -> CssResult<T> {
        parse_until_after(
            self,
            delimiters,
            ParseUntilErrorBehavior::Consume,
            (),
            |(), p| parse_fn(p),
        )
    }

    pub fn parse_until_before<T>(
        &mut self,
        delimiters: Delimiters,
        parse_fn: impl FnOnce(&mut Parser) -> CssResult<T>,
    ) -> CssResult<T> {
        parse_until_before(
            self,
            delimiters,
            ParseUntilErrorBehavior::Consume,
            (),
            |(), p| parse_fn(p),
        )
    }

    pub fn parse_entirely<T, C>(
        &mut self,
        closure: C,
        parsefn: impl FnOnce(C, &mut Parser) -> CssResult<T>,
    ) -> CssResult<T> {
        let result = parsefn(closure, self)?;
        self.expect_exhausted()?;
        Ok(result)
    }

    /// Check whether the input is exhausted. That is, if `.next()` would
    /// return a token. This ignores whitespace and comments.
    pub fn expect_exhausted(&mut self) -> CssResult<()> {
        let start = self.state();
        let result: CssResult<()> = match self.next() {
            Ok(t) => {
                let t = t.clone();
                Err(start.source_location().new_unexpected_token_error(t))
            }
            Err(e) => {
                if matches!(
                    e.kind,
                    errors_::ParseErrorKind::Basic(BasicParseErrorKind::EndOfInput)
                ) {
                    Ok(())
                } else {
                    unreachable!("Unexpected error encountered: {:?}", e.kind);
                }
            }
        };
        self.reset(&start);
        result
    }

    pub fn skip_cdc_and_cdo(&mut self) {
        if let Some(block_type) = self.at_start_of.take() {
            consume_until_end_of_block(block_type, &mut self.input.tokenizer);
        }
        self.input.tokenizer.skip_cdc_and_cdo();
    }

    pub fn skip_whitespace(&mut self) {
        if let Some(block_type) = self.at_start_of.take() {
            consume_until_end_of_block(block_type, &mut self.input.tokenizer);
        }
        self.input.tokenizer.skip_whitespace();
    }

    pub fn next(&mut self) -> CssResult<&Token> {
        self.skip_whitespace();
        self.next_including_whitespace_and_comments()
    }

    /// Same as `Parser::next`, but does not skip whitespace tokens.
    pub fn next_including_whitespace(&mut self) -> CssResult<&Token> {
        loop {
            match self.next_including_whitespace_and_comments() {
                Ok(tok) => {
                    if matches!(tok, Token::Comment(_)) {
                        continue;
                    } else {
                        break;
                    }
                }
                Err(e) => return Err(e),
            }
        }
        Ok(&self.input.cached_token.as_ref().unwrap().token)
    }

    pub fn next_byte(&self) -> Option<u8> {
        let byte = self.input.tokenizer.next_byte();
        if self.stop_before.contains(Delimiters::from_byte(byte)) {
            return None;
        }
        byte
    }

    pub fn reset(&mut self, state_: &ParserState) {
        self.input.tokenizer.reset(state_);
        self.at_start_of = state_.at_start_of;
        if let Some(import_records) = &mut self.import_records {
            import_records.set_len(state_.import_record_count);
        }
    }

    pub fn state(&self) -> ParserState {
        ParserState {
            position: self.input.tokenizer.get_position(),
            current_line_start_position: self.input.tokenizer.current_line_start_position,
            current_line_number: self.input.tokenizer.current_line_number,
            at_start_of: self.at_start_of,
            import_record_count: self
                .import_records
                .as_ref()
                .map(|ir| ir.len())
                .unwrap_or(0),
        }
    }

    /// Same as `Parser::next`, but does not skip whitespace or comment tokens.
    pub fn next_including_whitespace_and_comments(&mut self) -> CssResult<&Token> {
        if let Some(block_type) = self.at_start_of.take() {
            consume_until_end_of_block(block_type, &mut self.input.tokenizer);
        }

        let byte = self.input.tokenizer.next_byte();
        if self.stop_before.contains(Delimiters::from_byte(byte)) {
            return Err(self.new_error(BasicParseErrorKind::EndOfInput));
        }

        let token_start_position = self.input.tokenizer.get_position();
        let using_cached_token = self
            .input
            .cached_token
            .as_ref()
            .map(|ct| ct.start_position == token_start_position)
            .unwrap_or(false);

        let token: &Token = if using_cached_token {
            let cached_token = self.input.cached_token.as_ref().unwrap();
            self.input.tokenizer.reset(&cached_token.end_state);
            if let Token::Function(f) = &cached_token.token {
                self.input.tokenizer.see_function(f);
            }
            &self.input.cached_token.as_ref().unwrap().token
        } else {
            let new_token = match self.input.tokenizer.next() {
                Ok(v) => v,
                Err(()) => return Err(self.new_error(BasicParseErrorKind::EndOfInput)),
            };
            self.input.cached_token = Some(CachedToken {
                token: new_token,
                start_position: token_start_position,
                end_state: self.input.tokenizer.state(),
            });
            &self.input.cached_token.as_ref().unwrap().token
        };

        if let Some(block_type) = BlockType::opening(token) {
            self.at_start_of = Some(block_type);
        }

        Ok(token)
    }

    /// Create a new unexpected token or EOF ParseError at the current location
    pub fn new_error_for_next_token(&mut self) -> ParseError<ParserError> {
        let token = match self.next() {
            Ok(t) => t.clone(),
            Err(e) => return e,
        };
        self.new_error(BasicParseErrorKind::UnexpectedToken(token))
    }
}

// ───────────────────────────── Delimiters ─────────────────────────────

bitflags::bitflags! {
    /// A set of characters, to be used with the `Parser::parse_until*`
    /// methods. The union of two sets can be obtained with `|`.
    #[derive(Clone, Copy, PartialEq, Eq, Default)]
    pub struct Delimiters: u8 {
        /// `{` opening curly bracket
        const CURLY_BRACKET        = 0b0000_0001;
        /// `;` semicolon
        const SEMICOLON            = 0b0000_0010;
        /// `!` exclamation point
        const BANG                 = 0b0000_0100;
        /// `,` comma
        const COMMA                = 0b0000_1000;
        const CLOSE_CURLY_BRACKET  = 0b0001_0000;
        const CLOSE_SQUARE_BRACKET = 0b0010_0000;
        const CLOSE_PARENTHESIS    = 0b0100_0000;
    }
}

impl Delimiters {
    pub const NONE: Delimiters = Delimiters::empty();

    const TABLE: [Delimiters; 256] = {
        let mut table = [Delimiters::empty(); 256];
        table[b';' as usize] = Delimiters::SEMICOLON;
        table[b'!' as usize] = Delimiters::BANG;
        table[b',' as usize] = Delimiters::COMMA;
        table[b'{' as usize] = Delimiters::CURLY_BRACKET;
        table[b'}' as usize] = Delimiters::CLOSE_CURLY_BRACKET;
        table[b']' as usize] = Delimiters::CLOSE_SQUARE_BRACKET;
        table[b')' as usize] = Delimiters::CLOSE_PARENTHESIS;
        table
    };

    pub fn from_byte(byte: Option<u8>) -> Delimiters {
        match byte {
            Some(b) => Self::TABLE[b as usize],
            None => Delimiters::empty(),
        }
    }
}

pub struct ParserInput<'a> {
    pub tokenizer: Tokenizer<'a>,
    pub cached_token: Option<CachedToken>,
}

impl<'a> ParserInput<'a> {
    pub fn new(code: &'a [u8]) -> ParserInput<'a> {
        ParserInput { tokenizer: Tokenizer::init(code), cached_token: None }
    }
}

/// A capture of the internal state of a `Parser` (including the position
/// within the input), obtained from the `Parser::position` method.
#[derive(Clone)]
pub struct ParserState {
    pub position: usize,
    pub current_line_start_position: usize,
    pub current_line_number: u32,
    pub import_record_count: u32,
    pub at_start_of: Option<BlockType>,
}

impl ParserState {
    pub fn source_location(&self) -> SourceLocation {
        SourceLocation {
            line: self.current_line_number,
            column: u32::try_from(self.position - self.current_line_start_position + 1).unwrap(),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum BlockType {
    Parenthesis,
    SquareBracket,
    CurlyBracket,
}

impl BlockType {
    fn opening(token: &Token) -> Option<BlockType> {
        match token {
            Token::Function(_) | Token::OpenParen => Some(BlockType::Parenthesis),
            Token::OpenSquare => Some(BlockType::SquareBracket),
            Token::OpenCurly => Some(BlockType::CurlyBracket),
            _ => None,
        }
    }

    fn closing(token: &Token) -> Option<BlockType> {
        match token {
            Token::CloseParen => Some(BlockType::Parenthesis),
            Token::CloseSquare => Some(BlockType::SquareBracket),
            Token::CloseCurly => Some(BlockType::CurlyBracket),
            _ => None,
        }
    }
}

// ───────────────────────────── nth ─────────────────────────────

pub mod nth {
    use super::*;

    pub type NthResult = (i32, i32);

    /// Parse the *An+B* notation, as found in the `:nth-child()` selector.
    pub fn parse_nth(input: &mut Parser) -> CssResult<NthResult> {
        let tok = input.next()?;
        match tok {
            Token::Number(n) => {
                if let Some(b) = n.int_value {
                    return Ok((0, b));
                }
            }
            Token::Dimension(d) => {
                if let Some(a) = d.num.int_value {
                    let unit = d.unit;
                    if strings::eql_case_insensitive_ascii_check_length(unit, b"n") {
                        return parse_b(input, a);
                    } else if strings::eql_case_insensitive_ascii_check_length(unit, b"n-") {
                        return parse_signless_b(input, a, -1);
                    } else {
                        if let Ok(b) = parse_n_dash_digits(unit) {
                            return Ok((a, b));
                        } else {
                            return Err(input.new_unexpected_token_error(Token::Ident(unit)));
                        }
                    }
                }
            }
            Token::Ident(value) => {
                let value = *value;
                if strings::eql_case_insensitive_ascii_ignore_length(value, b"even") {
                    return Ok((2, 0));
                } else if strings::eql_case_insensitive_ascii_ignore_length(value, b"odd") {
                    return Ok((2, 1));
                } else if strings::eql_case_insensitive_ascii_ignore_length(value, b"n") {
                    return parse_b(input, 1);
                } else if strings::eql_case_insensitive_ascii_ignore_length(value, b"-n") {
                    return parse_b(input, -1);
                } else if strings::eql_case_insensitive_ascii_ignore_length(value, b"n-") {
                    return parse_signless_b(input, 1, -1);
                } else if strings::eql_case_insensitive_ascii_ignore_length(value, b"-n-") {
                    return parse_signless_b(input, -1, -1);
                } else {
                    let (slice, a): (&[u8], i32) = if value.first() == Some(&b'-') {
                        (&value[1..], -1)
                    } else {
                        (value, 1)
                    };
                    if let Ok(b) = parse_n_dash_digits(slice) {
                        return Ok((a, b));
                    }
                    return Err(input.new_unexpected_token_error(Token::Ident(value)));
                }
            }
            Token::Delim(_) => {
                let next_tok = input.next_including_whitespace()?;
                if let Token::Ident(value) = next_tok {
                    let value = *value;
                    if strings::eql_case_insensitive_ascii_check_length(value, b"n") {
                        return parse_b(input, 1);
                    } else if strings::eql_case_insensitive_ascii_check_length(value, b"-n") {
                        return parse_signless_b(input, 1, -1);
                    } else {
                        if let Ok(b) = parse_n_dash_digits(value) {
                            return Ok((1, b));
                        } else {
                            return Err(input.new_unexpected_token_error(Token::Ident(value)));
                        }
                    }
                } else {
                    let tok = next_tok.clone();
                    return Err(input.new_unexpected_token_error(tok));
                }
            }
            _ => {}
        }
        let tok = tok.clone();
        Err(input.new_unexpected_token_error(tok))
    }

    fn parse_b(input: &mut Parser, a: i32) -> CssResult<NthResult> {
        let start = input.state();
        let tok = match input.next() {
            Ok(v) => v,
            Err(_) => {
                input.reset(&start);
                return Ok((a, 0));
            }
        };

        if let Token::Delim(d) = tok {
            if *d == b'+' as u32 {
                return parse_signless_b(input, a, 1);
            }
            if *d == b'-' as u32 {
                return parse_signless_b(input, a, -1);
            }
        }
        if let Token::Number(n) = tok {
            if n.has_sign && n.int_value.is_some() {
                return Ok((a, n.int_value.unwrap()));
            }
        }
        input.reset(&start);
        Ok((a, 0))
    }

    fn parse_signless_b(input: &mut Parser, a: i32, b_sign: i32) -> CssResult<NthResult> {
        let tok = input.next()?;
        if let Token::Number(n) = tok {
            if !n.has_sign && n.int_value.is_some() {
                let b = n.int_value.unwrap();
                return Ok((a, b_sign * b));
            }
        }
        let tok = tok.clone();
        Err(input.new_unexpected_token_error(tok))
    }

    fn parse_n_dash_digits(str: &[u8]) -> Maybe<i32, ()> {
        let bytes = str;
        if bytes.len() >= 3
            && strings::eql_case_insensitive_ascii_check_length(&bytes[0..2], b"n-")
            && bytes[2..].iter().all(|&b| b >= b'0' && b <= b'9')
        {
            parse_number_saturate(&str[1..]) // Include the minus sign
        } else {
            Err(())
        }
    }

    fn parse_number_saturate(string: &[u8]) -> Maybe<i32, ()> {
        let mut input = ParserInput::new(string);
        let mut parser = Parser::new(&mut input, None, ParserOpts::default(), None);
        let tok = match parser.next_including_whitespace_and_comments() {
            Ok(v) => v,
            Err(_) => return Err(()),
        };
        let int = if let Token::Number(n) = tok {
            if let Some(i) = n.int_value {
                i
            } else {
                return Err(());
            }
        } else {
            return Err(());
        };
        if !parser.is_exhausted() {
            return Err(());
        }
        Ok(int)
    }
}

#[derive(Clone)]
pub struct CachedToken {
    pub token: Token,
    pub start_position: usize,
    pub end_state: ParserState,
}

// ───────────────────────────── Tokenizer ─────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq)]
enum SeenStatus {
    DontCare,
    LookingForThem,
    SeenAtLeastOne,
}

pub struct Tokenizer<'a> {
    pub src: &'a [u8],
    pub position: usize,
    pub source_map_url: Option<&'a [u8]>,
    pub current_line_start_position: usize,
    pub current_line_number: u32,
    // TODO(port): AST crate — keep arena. Zig threaded `Allocator`; in Rust
    // this is `&'a Bump`.
    pub allocator: &'a Bump,
    var_or_env_functions: SeenStatus,
    pub current: Token,
    pub previous: Token,
}

const FORM_FEED_BYTE: u8 = 0x0C;
const REPLACEMENT_CHAR: u32 = 0xFFFD;
const REPLACEMENT_CHAR_UNICODE: [u8; 3] = [0xEF, 0xBF, 0xBD];
const MAX_ONE_B: u32 = 0x80;
const MAX_TWO_B: u32 = 0x800;
const MAX_THREE_B: u32 = 0x10000;

impl<'a> Tokenizer<'a> {
    pub fn init(src: &'a [u8]) -> Tokenizer<'a> {
        // TODO(port): allocator param dropped; arena threaded externally.
        // For Phase A draft, leave a placeholder.
        Tokenizer {
            src,
            position: 0,
            source_map_url: None,
            current_line_start_position: 0,
            current_line_number: 0,
            allocator: Bump::leak_placeholder(), // TODO(port): thread &Bump
            var_or_env_functions: SeenStatus::DontCare,
            current: Token::Whitespace(b""),
            previous: Token::Whitespace(b""),
        }
    }

    pub fn current_source_map_url(&self) -> Option<&[u8]> {
        self.source_map_url
    }

    pub fn get_position(&self) -> usize {
        debug_assert!(strings::is_on_char_boundary(self.src, self.position));
        self.position
    }

    pub fn state(&self) -> ParserState {
        ParserState {
            position: self.position,
            current_line_start_position: self.current_line_start_position,
            current_line_number: self.current_line_number,
            at_start_of: None,
            import_record_count: 0,
        }
    }

    pub fn skip_whitespace(&mut self) {
        while !self.is_eof() {
            // todo_stuff.match_byte
            match self.next_byte_unchecked() {
                b' ' | b'\t' => self.advance(1),
                b'\n' | 0x0C | b'\r' => self.consume_newline(),
                b'/' => {
                    if self.starts_with(b"/*") {
                        let _ = self.consume_comment();
                    } else {
                        return;
                    }
                }
                _ => return,
            }
        }
    }

    pub fn current_source_location(&self) -> SourceLocation {
        SourceLocation {
            line: self.current_line_number,
            column: u32::try_from((self.position - self.current_line_start_position) + 1).unwrap(),
        }
    }

    pub fn prev(&self) -> Token {
        debug_assert!(self.position > 0);
        self.previous.clone()
    }

    #[inline]
    pub fn is_eof(&self) -> bool {
        self.position >= self.src.len()
    }

    pub fn see_function(&mut self, name: &[u8]) {
        if self.var_or_env_functions == SeenStatus::LookingForThem {
            // PORT NOTE: Zig had `and` here (always false); preserved.
            if name.eq_ignore_ascii_case(b"var") && name.eq_ignore_ascii_case(b"env") {
                self.var_or_env_functions = SeenStatus::SeenAtLeastOne;
            }
        }
    }

    /// Return error if it is eof.
    #[inline]
    pub fn next(&mut self) -> Maybe<Token, ()> {
        self.next_impl()
    }

    pub fn next_impl(&mut self) -> Maybe<Token, ()> {
        if self.is_eof() {
            return Err(());
        }

        // todo_stuff.match_byte
        let b = self.byte_at(0);
        let token: Token = match b {
            b' ' | b'\t' => self.consume_whitespace::<false>(),
            b'\n' | FORM_FEED_BYTE | b'\r' => self.consume_whitespace::<true>(),
            b'"' => self.consume_string::<false>(),
            b'#' => {
                self.advance(1);
                if self.is_ident_start() {
                    Token::IdHash(self.consume_name())
                } else if !self.is_eof()
                    && matches!(self.next_byte_unchecked(), b'0'..=b'9' | b'-')
                {
                    Token::UnrestrictedHash(self.consume_name())
                } else {
                    Token::Delim(b'#' as u32)
                }
            }
            b'$' => {
                if self.starts_with(b"$=") {
                    self.advance(2);
                    Token::SuffixMatch
                } else {
                    self.advance(1);
                    Token::Delim(b'$' as u32)
                }
            }
            b'\'' => self.consume_string::<true>(),
            b'(' => {
                self.advance(1);
                Token::OpenParen
            }
            b')' => {
                self.advance(1);
                Token::CloseParen
            }
            b'*' => {
                if self.starts_with(b"*=") {
                    self.advance(2);
                    Token::SubstringMatch
                } else {
                    self.advance(1);
                    Token::Delim(b'*' as u32)
                }
            }
            b'+' => {
                if (self.has_at_least(1) && matches!(self.byte_at(1), b'0'..=b'9'))
                    || (self.has_at_least(2)
                        && self.byte_at(1) == b'.'
                        && matches!(self.byte_at(2), b'0'..=b'9'))
                {
                    self.consume_numeric()
                } else {
                    self.advance(1);
                    Token::Delim(b'+' as u32)
                }
            }
            b',' => {
                self.advance(1);
                Token::Comma
            }
            b'-' => {
                if (self.has_at_least(1) && matches!(self.byte_at(1), b'0'..=b'9'))
                    || (self.has_at_least(2)
                        && self.byte_at(1) == b'.'
                        && matches!(self.byte_at(2), b'0'..=b'9'))
                {
                    self.consume_numeric()
                } else if self.starts_with(b"-->") {
                    self.advance(3);
                    Token::Cdc
                } else if self.is_ident_start() {
                    self.consume_ident_like()
                } else {
                    self.advance(1);
                    Token::Delim(b'-' as u32)
                }
            }
            b'.' => {
                if self.has_at_least(1) && matches!(self.byte_at(1), b'0'..=b'9') {
                    self.consume_numeric()
                } else {
                    self.advance(1);
                    Token::Delim(b'.' as u32)
                }
            }
            b'/' => {
                if self.starts_with(b"/*") {
                    Token::Comment(self.consume_comment())
                } else {
                    self.advance(1);
                    Token::Delim(b'/' as u32)
                }
            }
            b'0'..=b'9' => self.consume_numeric(),
            b':' => {
                self.advance(1);
                Token::Colon
            }
            b';' => {
                self.advance(1);
                Token::Semicolon
            }
            b'<' => {
                if self.starts_with(b"<!--") {
                    self.advance(4);
                    Token::Cdo
                } else {
                    self.advance(1);
                    Token::Delim(b'<' as u32)
                }
            }
            b'@' => {
                self.advance(1);
                if self.is_ident_start() {
                    Token::AtKeyword(self.consume_name())
                } else {
                    Token::Delim(b'@' as u32)
                }
            }
            b'a'..=b'z' | b'A'..=b'Z' | b'_' | 0 => self.consume_ident_like(),
            b'[' => {
                self.advance(1);
                Token::OpenSquare
            }
            b'\\' => {
                if !self.has_newline_at(1) {
                    self.consume_ident_like()
                } else {
                    self.advance(1);
                    Token::Delim(b'\\' as u32)
                }
            }
            b']' => {
                self.advance(1);
                Token::CloseSquare
            }
            b'^' => {
                if self.starts_with(b"^=") {
                    self.advance(2);
                    Token::PrefixMatch
                } else {
                    self.advance(1);
                    Token::Delim(b'^' as u32)
                }
            }
            b'{' => {
                self.advance(1);
                Token::OpenCurly
            }
            b'|' => {
                if self.starts_with(b"|=") {
                    self.advance(2);
                    Token::DashMatch
                } else {
                    self.advance(1);
                    Token::Delim(b'|' as u32)
                }
            }
            b'}' => {
                self.advance(1);
                Token::CloseCurly
            }
            b'~' => {
                if self.starts_with(b"~=") {
                    self.advance(2);
                    Token::IncludeMatch
                } else {
                    self.advance(1);
                    Token::Delim(b'~' as u32)
                }
            }
            _ => {
                if !b.is_ascii() {
                    self.consume_ident_like()
                } else {
                    self.advance(1);
                    Token::Delim(b as u32)
                }
            }
        };

        Ok(token)
    }

    pub fn reset(&mut self, state2: &ParserState) {
        self.position = state2.position;
        self.current_line_start_position = state2.current_line_start_position;
        self.current_line_number = state2.current_line_number;
    }

    pub fn skip_cdc_and_cdo(&mut self) {
        while !self.is_eof() {
            // todo_stuff.match_byte
            match self.next_byte_unchecked() {
                b' ' | b'\t' => self.advance(1),
                b'\n' | 0x0C | b'\r' => self.consume_newline(),
                b'/' => {
                    if self.starts_with(b"/*") {
                        let _ = self.consume_comment();
                    } else {
                        return;
                    }
                }
                b'<' => {
                    if self.starts_with(b"<!--") {
                        self.advance(4);
                    } else {
                        return;
                    }
                }
                b'-' => {
                    if self.starts_with(b"-->") {
                        self.advance(3);
                    } else {
                        return;
                    }
                }
                _ => return,
            }
        }
    }

    pub fn consume_numeric(&mut self) -> Token {
        // Parse [+-]?\d*(\.\d+)?([eE][+-]?\d+)?
        // But this is always called so that there is at least one digit in \d*(\.\d+)?

        // Do all the math in f64 so that large numbers overflow to +/-inf
        // and i32::{MIN, MAX} are within range.
        let (has_sign, sign): (bool, f64) = match self.next_byte_unchecked() {
            b'-' => (true, -1.0),
            b'+' => (true, 1.0),
            _ => (false, 1.0),
        };

        if has_sign {
            self.advance(1);
        }

        let mut integral_part: f64 = 0.0;
        while let Some(digit) = byte_to_decimal_digit(self.next_byte_unchecked()) {
            integral_part = integral_part * 10.0 + digit as f64;
            self.advance(1);
            if self.is_eof() {
                break;
            }
        }

        let mut is_integer = true;

        let mut fractional_part: f64 = 0.0;
        if self.has_at_least(1)
            && self.next_byte_unchecked() == b'.'
            && matches!(self.byte_at(1), b'0'..=b'9')
        {
            is_integer = false;
            self.advance(1); // Consume '.'
            let mut factor: f64 = 0.1;
            while let Some(digit) = byte_to_decimal_digit(self.next_byte_unchecked()) {
                fractional_part += digit as f64 * factor;
                factor *= 0.1;
                self.advance(1);
                if self.is_eof() {
                    break;
                }
            }
        }

        let mut value: f64 = sign * (integral_part + fractional_part);

        if self.has_at_least(1) && matches!(self.next_byte_unchecked(), b'e' | b'E') {
            if matches!(self.byte_at(1), b'0'..=b'9')
                || (self.has_at_least(2)
                    && matches!(self.byte_at(1), b'+' | b'-')
                    && matches!(self.byte_at(2), b'0'..=b'9'))
            {
                is_integer = false;
                self.advance(1);
                let (has_sign2, sign2): (bool, f64) = match self.next_byte_unchecked() {
                    b'-' => (true, -1.0),
                    b'+' => (true, 1.0),
                    _ => (false, 1.0),
                };
                if has_sign2 {
                    self.advance(1);
                }

                let mut exponent: f64 = 0.0;
                while let Some(digit) = byte_to_decimal_digit(self.next_byte_unchecked()) {
                    exponent = exponent * 10.0 + digit as f64;
                    self.advance(1);
                    if self.is_eof() {
                        break;
                    }
                }
                value *= (10.0f64).powf(sign2 * exponent);
            }
        }

        let int_value: Option<i32> = if is_integer {
            // Zig: bun.intFromFloat — saturating cast.
            Some(value as i32)
        } else {
            None
        };

        if !self.is_eof() && self.next_byte_unchecked() == b'%' {
            self.advance(1);
            return Token::Percentage {
                unit_value: (value / 100.0) as f32,
                int_value,
                has_sign,
            };
        }

        if self.is_ident_start() {
            let unit = self.consume_name();
            return Token::Dimension(Dimension {
                num: Num { value: value as f32, int_value, has_sign },
                unit,
            });
        }

        Token::Number(Num { value: value as f32, int_value, has_sign })
    }

    pub fn consume_whitespace<const NEWLINE: bool>(&mut self) -> Token {
        let start_position = self.position;
        if NEWLINE {
            self.consume_newline();
        } else {
            self.advance(1);
        }

        while !self.is_eof() {
            // todo_stuff.match_byte
            match self.next_byte_unchecked() {
                b' ' | b'\t' => self.advance(1),
                b'\n' | FORM_FEED_BYTE | b'\r' => self.consume_newline(),
                _ => break,
            }
        }

        Token::Whitespace(self.slice_from(start_position))
    }

    pub fn consume_string<const SINGLE_QUOTE: bool>(&mut self) -> Token {
        let (str, bad) = self.consume_quoted_string::<SINGLE_QUOTE>();
        if bad {
            Token::BadString(str)
        } else {
            Token::QuotedString(str)
        }
    }

    pub fn consume_ident_like(&mut self) -> Token {
        let value = self.consume_name();
        if !self.is_eof() && self.next_byte_unchecked() == b'(' {
            self.advance(1);
            if value.eq_ignore_ascii_case(b"url") {
                if let Some(tok) = self.consume_unquoted_url() {
                    return tok;
                }
                return Token::Function(value);
            }
            self.see_function(value);
            return Token::Function(value);
        }
        Token::Ident(value)
    }

    pub fn consume_name(&mut self) -> &'a [u8] {
        let start_pos = self.position;
        let mut value_bytes: CopyOnWriteStr;

        loop {
            if self.is_eof() {
                return self.slice_from(start_pos);
            }
            // todo_stuff.match_byte
            match self.next_byte_unchecked() {
                b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_' | b'-' => self.advance(1),
                b'\\' | 0 => {
                    value_bytes = CopyOnWriteStr::Borrowed(self.slice_from(start_pos));
                    break;
                }
                0x80..=0xBF => self.consume_continuation_byte(),
                0xC0..=0xEF => self.advance(1),
                0xF0..=0xFF => self.consume_4byte_intro(),
                _ => return self.slice_from(start_pos),
            }
        }

        while !self.is_eof() {
            let b = self.next_byte_unchecked();
            // todo_stuff.match_byte
            match b {
                b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_' | b'-' => {
                    self.advance(1);
                    value_bytes.append(self.allocator, &[b]);
                }
                b'\\' => {
                    if self.has_newline_at(1) {
                        break;
                    }
                    self.advance(1);
                    self.consume_escape_and_write(&mut value_bytes);
                }
                0 => {
                    self.advance(1);
                    value_bytes.append(self.allocator, &REPLACEMENT_CHAR_UNICODE);
                }
                0x80..=0xBF => {
                    self.consume_continuation_byte();
                    value_bytes.append(self.allocator, &[b]);
                }
                0xC0..=0xEF => {
                    self.advance(1);
                    value_bytes.append(self.allocator, &[b]);
                }
                0xF0..=0xFF => {
                    self.consume_4byte_intro();
                    value_bytes.append(self.allocator, &[b]);
                }
                _ => {
                    // ASCII
                    break;
                }
            }
        }

        value_bytes.to_slice()
    }

    pub fn consume_quoted_string<const SINGLE_QUOTE: bool>(&mut self) -> (&'a [u8], bool) {
        self.advance(1); // Skip the initial quote
        let start_pos = self.position;
        let mut string_bytes: CopyOnWriteStr;

        loop {
            if self.is_eof() {
                return (self.slice_from(start_pos), false);
            }
            // todo_stuff.match_byte
            match self.next_byte_unchecked() {
                b'"' => {
                    if !SINGLE_QUOTE {
                        let value = self.slice_from(start_pos);
                        self.advance(1);
                        return (value, false);
                    }
                    self.advance(1);
                }
                b'\'' => {
                    if SINGLE_QUOTE {
                        let value = self.slice_from(start_pos);
                        self.advance(1);
                        return (value, false);
                    }
                    self.advance(1);
                }
                // The CSS spec says NULL bytes should be turned into replacement chars: 0xFFFD
                b'\\' | 0 => {
                    string_bytes = CopyOnWriteStr::Borrowed(self.slice_from(start_pos));
                    break;
                }
                b'\n' | b'\r' | FORM_FEED_BYTE => {
                    return (self.slice_from(start_pos), true);
                }
                0x80..=0xBF => self.consume_continuation_byte(),
                0xF0..=0xFF => self.consume_4byte_intro(),
                _ => {
                    self.advance(1);
                }
            }
        }

        while !self.is_eof() {
            let b = self.next_byte_unchecked();
            // todo_stuff.match_byte
            match b {
                b'\n' | b'\r' | FORM_FEED_BYTE => return (string_bytes.to_slice(), true),
                b'"' => {
                    self.advance(1);
                    if !SINGLE_QUOTE {
                        break;
                    }
                }
                b'\'' => {
                    self.advance(1);
                    if SINGLE_QUOTE {
                        break;
                    }
                }
                b'\\' => {
                    self.advance(1);
                    if !self.is_eof() {
                        match self.next_byte_unchecked() {
                            // Escaped newline
                            b'\n' | FORM_FEED_BYTE | b'\r' => self.consume_newline(),
                            _ => self.consume_escape_and_write(&mut string_bytes),
                        }
                    }
                    // else: escaped EOF, do nothing.
                    continue;
                }
                0 => {
                    self.advance(1);
                    string_bytes.append(self.allocator, &REPLACEMENT_CHAR_UNICODE);
                    continue;
                }
                0x80..=0xBF => self.consume_continuation_byte(),
                0xF0..=0xFF => self.consume_4byte_intro(),
                _ => {
                    self.advance(1);
                }
            }

            string_bytes.append(self.allocator, &[b]);
        }

        (string_bytes.to_slice(), false)
    }

    pub fn consume_unquoted_url(&mut self) -> Option<Token> {
        // This is only called after "url(", so the current position is a code point boundary.
        let start_position = self.position;
        let from_start = &self.src[self.position..];
        let mut newlines: u32 = 0;
        let mut last_newline: usize = 0;
        let mut found_printable_char = false;

        let mut offset: usize = 0;
        loop {
            let b = if offset < from_start.len() {
                from_start[offset]
            } else {
                self.position = self.src.len();
                offset += 1;
                break;
            };

            // todo_stuff.match_byte
            match b {
                b' ' | b'\t' => {}
                b'\n' | FORM_FEED_BYTE => {
                    newlines += 1;
                    last_newline = offset;
                }
                b'\r' => {
                    if offset + 1 < from_start.len() && from_start[offset + 1] != b'\n' {
                        newlines += 1;
                        last_newline = offset;
                    }
                }
                b'"' | b'\'' => return None, // Do not advance
                b')' => {
                    self.position += offset + 1;
                    offset += 1;
                    break;
                }
                _ => {
                    self.position += offset;
                    found_printable_char = true;
                    offset += 1;
                    break;
                }
            }
            offset += 1;
        }
        let _ = offset;

        if newlines > 0 {
            self.current_line_number += newlines;
            self.current_line_start_position = start_position + last_newline + 1;
        }

        if found_printable_char {
            return Some(self.consume_unquoted_url_internal());
        }
        Some(Token::UnquotedUrl(b""))
    }

    pub fn consume_unquoted_url_internal(&mut self) -> Token {
        let start_pos = self.position;
        let mut string_bytes: CopyOnWriteStr;

        loop {
            if self.is_eof() {
                return Token::UnquotedUrl(self.slice_from(start_pos));
            }
            // todo_stuff.match_byte
            match self.next_byte_unchecked() {
                b' ' | b'\t' | b'\n' | b'\r' | FORM_FEED_BYTE => {
                    let mut value = CopyOnWriteStr::Borrowed(self.slice_from(start_pos));
                    return self.consume_url_end(start_pos, &mut value);
                }
                b')' => {
                    let value = self.slice_from(start_pos);
                    self.advance(1);
                    return Token::UnquotedUrl(value);
                }
                // non-printable / not valid in this context
                0x01..=0x08 | 0x0B | 0x0E..=0x1F | 0x7F | b'"' | b'\'' | b'(' => {
                    self.advance(1);
                    return self.consume_bad_url(start_pos);
                }
                b'\\' | 0 => {
                    string_bytes = CopyOnWriteStr::Borrowed(self.slice_from(start_pos));
                    break;
                }
                0x80..=0xBF => self.consume_continuation_byte(),
                0xF0..=0xFF => self.consume_4byte_intro(),
                _ => {
                    // ASCII or other leading byte.
                    self.advance(1);
                }
            }
        }

        while !self.is_eof() {
            let b = self.next_byte_unchecked();
            // todo_stuff.match_byte
            match b {
                b' ' | b'\t' | b'\n' | b'\r' | FORM_FEED_BYTE => {
                    return self.consume_url_end(start_pos, &mut string_bytes);
                }
                b')' => {
                    self.advance(1);
                    break;
                }
                0x01..=0x08 | 0x0B | 0x0E..=0x1F | 0x7F | b'"' | b'\'' | b'(' => {
                    self.advance(1);
                    return self.consume_bad_url(start_pos);
                }
                b'\\' => {
                    self.advance(1);
                    if self.has_newline_at(0) {
                        return self.consume_bad_url(start_pos);
                    }
                    self.consume_escape_and_write(&mut string_bytes);
                }
                0 => {
                    self.advance(1);
                    string_bytes.append(self.allocator, &REPLACEMENT_CHAR_UNICODE);
                }
                0x80..=0xBF => {
                    self.consume_continuation_byte();
                    string_bytes.append(self.allocator, &[b]);
                }
                0xF0..=0xFF => {
                    self.consume_4byte_intro();
                    string_bytes.append(self.allocator, &[b]);
                }
                _ => {
                    self.advance(1);
                    string_bytes.append(self.allocator, &[b]);
                }
            }
        }

        Token::UnquotedUrl(string_bytes.to_slice())
    }

    pub fn consume_url_end(&mut self, start_pos: usize, string: &mut CopyOnWriteStr<'a>) -> Token {
        while !self.is_eof() {
            // todo_stuff.match_byte
            match self.next_byte_unchecked() {
                b')' => {
                    self.advance(1);
                    break;
                }
                b' ' | b'\t' => self.advance(1),
                b'\n' | FORM_FEED_BYTE | b'\r' => self.consume_newline(),
                b => {
                    self.consume_known_byte(b);
                    return self.consume_bad_url(start_pos);
                }
            }
        }
        Token::UnquotedUrl(string.to_slice())
    }

    pub fn consume_bad_url(&mut self, start_pos: usize) -> Token {
        // Consume up to the closing )
        while !self.is_eof() {
            // todo_stuff.match_byte
            match self.next_byte_unchecked() {
                b')' => {
                    let contents = self.slice_from(start_pos);
                    self.advance(1);
                    return Token::BadUrl(contents);
                }
                b'\\' => {
                    self.advance(1);
                    if let Some(b) = self.next_byte() {
                        if b == b')' || b == b'\\' {
                            self.advance(1); // Skip an escaped ')' or '\'
                        }
                    }
                }
                b'\n' | FORM_FEED_BYTE | b'\r' => self.consume_newline(),
                b => self.consume_known_byte(b),
            }
        }
        Token::BadUrl(self.slice_from(start_pos))
    }

    pub fn consume_escape_and_write(&mut self, bytes: &mut CopyOnWriteStr<'a>) {
        let val = self.consume_escape();
        let mut utf8bytes = [0u8; 4];
        // TODO(port): Zig used std.unicode.utf8Encode; use bun_str equivalent.
        let len = strings::encode_wtf8_rune(val, &mut utf8bytes);
        bytes.append(self.allocator, &utf8bytes[..len]);
    }

    pub fn consume_escape(&mut self) -> u32 {
        if self.is_eof() {
            return 0xFFFD; // Unicode replacement character
        }
        // todo_stuff.match_byte
        match self.next_byte_unchecked() {
            b'0'..=b'9' | b'A'..=b'F' | b'a'..=b'f' => {
                let c = self.consume_hex_digits().0;
                if !self.is_eof() {
                    // todo_stuff.match_byte
                    match self.next_byte_unchecked() {
                        b' ' | b'\t' => self.advance(1),
                        b'\n' | FORM_FEED_BYTE | b'\r' => self.consume_newline(),
                        _ => {}
                    }
                }
                if c != 0 && strings::utf8_valid_codepoint(c) {
                    return c;
                }
                REPLACEMENT_CHAR
            }
            0 => {
                self.advance(1);
                REPLACEMENT_CHAR
            }
            _ => self.consume_char(),
        }
    }

    pub fn consume_hex_digits(&mut self) -> (u32, u32) {
        let mut value: u32 = 0;
        let mut digits: u32 = 0;
        while digits < 6 && !self.is_eof() {
            if let Some(digit) = byte_to_hex_digit(self.next_byte_unchecked()) {
                value = value * 16 + digit;
                digits += 1;
                self.advance(1);
            } else {
                break;
            }
        }
        (value, digits)
    }

    pub fn consume_char(&mut self) -> u32 {
        let c = self.next_char();
        let len_utf8 = len_utf8(c);
        self.position += len_utf8;
        // Note that due to the special case for the 4-byte sequence intro,
        // we must use wrapping add here.
        self.current_line_start_position =
            self.current_line_start_position.wrapping_add(len_utf8 - len_utf16(c));
        c
    }

    pub fn consume_comment(&mut self) -> &'a [u8] {
        self.advance(2);
        let start_position = self.position;
        while !self.is_eof() {
            let b = self.next_byte_unchecked();
            // todo_stuff.match_byte
            match b {
                b'*' => {
                    let end_position = self.position;
                    self.advance(1);
                    if self.next_byte() == Some(b'/') {
                        self.advance(1);
                        let contents = &self.src[start_position..end_position];
                        self.check_for_source_map(contents);
                        return contents;
                    }
                }
                b'\n' | FORM_FEED_BYTE | b'\r' => self.consume_newline(),
                0x80..=0xBF => self.consume_continuation_byte(),
                0xF0..=0xFF => self.consume_4byte_intro(),
                _ => {
                    // ASCII or other leading byte
                    self.advance(1);
                }
            }
        }
        let contents = self.slice_from(start_position);
        self.check_for_source_map(contents);
        contents
    }

    pub fn check_for_source_map(&mut self, contents: &'a [u8]) {
        {
            let directive = b"# sourceMappingURL=";
            let directive_old = b"@ sourceMappingURL=";
            if contents.starts_with(directive) || contents.starts_with(directive_old) {
                self.source_map_url = split_source_map(&contents[directive.len()..]);
            }
        }
        {
            let directive = b"# sourceURL=";
            let directive_old = b"@ sourceURL=";
            if contents.starts_with(directive) || contents.starts_with(directive_old) {
                self.source_map_url = split_source_map(&contents[directive.len()..]);
            }
        }
    }

    pub fn consume_newline(&mut self) {
        let byte = self.next_byte_unchecked();
        debug_assert!(byte == b'\r' || byte == b'\n' || byte == FORM_FEED_BYTE);
        self.position += 1;
        if byte == b'\r' && self.next_byte() == Some(b'\n') {
            self.position += 1;
        }
        self.current_line_start_position = self.position;
        self.current_line_number += 1;
    }

    /// Advance over a single UTF-8 continuation byte (0x80..=0xBF).
    pub fn consume_continuation_byte(&mut self) {
        debug_assert!(self.next_byte_unchecked() & 0xC0 == 0x80);
        // Continuation bytes contribute to column overcount.
        self.current_line_start_position = self.current_line_start_position.wrapping_add(1);
        self.position += 1;
    }

    /// Advance over a single byte; the byte must be a UTF-8 sequence leader
    /// for a 4-byte sequence (0xF0..=0xF7).
    pub fn consume_4byte_intro(&mut self) {
        debug_assert!(self.next_byte_unchecked() & 0xF0 == 0xF0);
        // This takes two UTF-16 characters to represent, so we actually have
        // an undercount.
        self.current_line_start_position = self.current_line_start_position.wrapping_sub(1);
        self.position += 1;
    }

    pub fn is_ident_start(&self) -> bool {
        // todo_stuff.match_byte
        !self.is_eof()
            && match self.next_byte_unchecked() {
                b'a'..=b'z' | b'A'..=b'Z' | b'_' | 0 => true,
                b'-' => {
                    self.has_at_least(1)
                        && match self.byte_at(1) {
                            b'a'..=b'z' | b'A'..=b'Z' | b'-' | b'_' | 0 => true,
                            b'\\' => !self.has_newline_at(1),
                            b => !b.is_ascii(),
                        }
                }
                b'\\' => !self.has_newline_at(1),
                b => !b.is_ascii(),
            }
    }

    /// If true, the input has at least `n` bytes left *after* the current one.
    fn has_at_least(&self, n: usize) -> bool {
        self.position + n < self.src.len()
    }

    fn has_newline_at(&self, offset: usize) -> bool {
        self.position + offset < self.src.len()
            && matches!(self.byte_at(offset), b'\n' | b'\r' | FORM_FEED_BYTE)
    }

    pub fn starts_with(&self, needle: &[u8]) -> bool {
        self.src[self.position..].starts_with(needle)
    }

    /// Advance over N bytes in the input.
    pub fn advance(&mut self, n: usize) {
        if cfg!(debug_assertions) {
            for i in 0..n {
                let b = self.byte_at(i);
                debug_assert!(b.is_ascii() || (b & 0xF0 != 0xF0 && b & 0xC0 != 0x80));
                debug_assert!(b != b'\r' && b != b'\n' && b != b'\x0C');
            }
        }
        self.position += n;
    }

    /// Advance over any kind of byte, excluding newlines.
    pub fn consume_known_byte(&mut self, byte: u8) {
        debug_assert!(byte != b'\r' && byte != b'\n' && byte != FORM_FEED_BYTE);
        self.position += 1;
        if byte & 0xF0 == 0xF0 {
            self.current_line_start_position = self.current_line_start_position.wrapping_sub(1);
        } else if byte & 0xC0 == 0x80 {
            self.current_line_start_position = self.current_line_start_position.wrapping_add(1);
        }
    }

    #[inline]
    pub fn byte_at(&self, n: usize) -> u8 {
        self.src[self.position + n]
    }

    #[inline]
    pub fn next_byte(&self) -> Option<u8> {
        if self.is_eof() {
            return None;
        }
        Some(self.src[self.position])
    }

    #[inline]
    pub fn next_char(&self) -> u32 {
        let len = strings::utf8_byte_sequence_length(self.src[self.position]);
        strings::decode_wtf8_rune_t(&self.src[self.position..], len, strings::UNICODE_REPLACEMENT)
    }

    #[inline]
    pub fn next_byte_unchecked(&self) -> u8 {
        self.src[self.position]
    }

    #[inline]
    pub fn slice_from(&self, start: usize) -> &'a [u8] {
        &self.src[start..self.position]
    }
}

fn len_utf8(code: u32) -> usize {
    if code < MAX_ONE_B {
        1
    } else if code < MAX_TWO_B {
        2
    } else if code < MAX_THREE_B {
        3
    } else {
        4
    }
}

fn len_utf16(ch: u32) -> usize {
    if (ch & 0xFFFF) == ch { 1 } else { 2 }
}

fn byte_to_hex_digit(b: u8) -> Option<u32> {
    // todo_stuff.match_byte
    match b {
        b'0'..=b'9' => Some((b - b'0') as u32),
        b'a'..=b'f' => Some((b - b'a' + 10) as u32),
        b'A'..=b'F' => Some((b - b'A' + 10) as u32),
        _ => None,
    }
}

fn byte_to_decimal_digit(b: u8) -> Option<u32> {
    if b >= b'0' && b <= b'9' {
        Some((b - b'0') as u32)
    } else {
        None
    }
}

pub fn split_source_map(contents: &[u8]) -> Option<&[u8]> {
    // FIXME: Use bun CodepointIterator
    // TODO(port): Zig used std.unicode.Utf8Iterator. Approximate with byte
    // scan since the delimiters are all ASCII.
    for (i, &c) in contents.iter().enumerate() {
        match c {
            b' ' | b'\t' | FORM_FEED_BYTE | b'\r' | b'\n' => {
                return Some(&contents[0..i + 1]);
                // PORT NOTE: Zig returned `[0..iter.i]` where `i` is *after*
                // the codepoint — preserved.
            }
            _ => {}
        }
    }
    None
}

// ───────────────────────────── Token ─────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum TokenKind {
    Ident,
    Function,
    AtKeyword,
    UnrestrictedHash,
    IdHash,
    QuotedString,
    BadString,
    UnquotedUrl,
    BadUrl,
    Delim,
    Number,
    Percentage,
    Dimension,
    Whitespace,
    Cdo,
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
    Comment,
}

impl TokenKind {
    pub fn to_string(self) -> &'static str {
        // TODO(port): Zig switch had stale variant names (close_bracket, hash,
        // string) and pattern-matched `delim` payload — which TokenKind has
        // none of. Preserved best-effort; Phase B revisits.
        match self {
            TokenKind::AtKeyword => "@-keyword",
            TokenKind::BadString => "bad string token",
            TokenKind::BadUrl => "bad URL token",
            TokenKind::Cdc => "\"-->\"",
            TokenKind::Cdo => "\"<!--\"",
            TokenKind::CloseCurly => "\"}\"",
            TokenKind::CloseSquare => "\"]\"",
            TokenKind::CloseParen => "\")\"",
            TokenKind::Colon => "\":\"",
            TokenKind::Comma => "\",\"",
            TokenKind::Delim => "delimiter",
            TokenKind::Dimension => "dimension",
            TokenKind::Function => "function token",
            TokenKind::UnrestrictedHash | TokenKind::IdHash => "hash token",
            TokenKind::Ident => "identifier",
            TokenKind::Number => "number",
            TokenKind::OpenCurly => "\"{\"",
            TokenKind::OpenSquare => "\"[\"",
            TokenKind::OpenParen => "\"(\"",
            TokenKind::Percentage => "percentage",
            TokenKind::Semicolon => "\";\"",
            TokenKind::QuotedString => "string token",
            TokenKind::UnquotedUrl => "URL token",
            TokenKind::Whitespace => "whitespace",
            TokenKind::Comment => "comment",
            TokenKind::IncludeMatch => "\"~=\"",
            TokenKind::DashMatch => "\"|=\"",
            TokenKind::PrefixMatch => "\"^=\"",
            TokenKind::SuffixMatch => "\"$=\"",
            TokenKind::SubstringMatch => "\"*=\"",
        }
    }
}

// TODO: make strings be allocated in string pool
// TODO(port): lifetime — every &[u8] payload borrows the arena/source. Phase
// A uses `&'static [u8]` placeholder; Phase B threads `<'a>`.
#[derive(Clone)]
pub enum Token {
    /// An [`<ident-token>`](https://drafts.csswg.org/css-syntax/#typedef-ident-token)
    Ident(&'static [u8]),
    /// Value is the ident
    Function(&'static [u8]),
    /// Value is the ident
    AtKeyword(&'static [u8]),
    /// `<hash-token>` with type flag "unrestricted". No `#` marker.
    UnrestrictedHash(&'static [u8]),
    /// `<hash-token>` with type flag "id". No `#` marker.
    IdHash(&'static [u8]),
    /// `<string-token>`. No quotes.
    QuotedString(&'static [u8]),
    BadString(&'static [u8]),
    /// `url(<string-token>)` is represented by a `Function` token
    UnquotedUrl(&'static [u8]),
    BadUrl(&'static [u8]),
    /// A `<delim-token>` — single codepoint. In practice always ASCII.
    Delim(u32),
    /// A `<number-token>`
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
    /// `~=`
    IncludeMatch,
    /// `|=`
    DashMatch,
    /// `^=`
    PrefixMatch,
    /// `$=`
    SuffixMatch,
    /// `*=`
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

impl Token {
    pub fn eql(lhs: &Token, rhs: &Token) -> bool {
        // TODO(port): Zig used implementEql (comptime field-walk).
        // Phase B: derive PartialEq once payload lifetimes settle.
        generic::implement_eql(lhs, rhs)
    }

    pub fn hash(&self, hasher: &mut bun_wyhash::Wyhash) {
        generic::implement_hash(self, hasher)
    }

    /// Return whether this token represents a parse error.
    pub fn is_parse_error(&self) -> bool {
        matches!(
            self,
            Token::BadUrl(_)
                | Token::BadString(_)
                | Token::CloseParen
                | Token::CloseSquare
                | Token::CloseCurly
        )
    }

    #[inline]
    pub fn kind(&self) -> TokenKind {
        match self {
            Token::Ident(_) => TokenKind::Ident,
            Token::Function(_) => TokenKind::Function,
            Token::AtKeyword(_) => TokenKind::AtKeyword,
            Token::UnrestrictedHash(_) => TokenKind::UnrestrictedHash,
            Token::IdHash(_) => TokenKind::IdHash,
            Token::QuotedString(_) => TokenKind::QuotedString,
            Token::BadString(_) => TokenKind::BadString,
            Token::UnquotedUrl(_) => TokenKind::UnquotedUrl,
            Token::BadUrl(_) => TokenKind::BadUrl,
            Token::Delim(_) => TokenKind::Delim,
            Token::Number(_) => TokenKind::Number,
            Token::Percentage { .. } => TokenKind::Percentage,
            Token::Dimension(_) => TokenKind::Dimension,
            Token::Whitespace(_) => TokenKind::Whitespace,
            Token::Cdo => TokenKind::Cdo,
            Token::Cdc => TokenKind::Cdc,
            Token::IncludeMatch => TokenKind::IncludeMatch,
            Token::DashMatch => TokenKind::DashMatch,
            Token::PrefixMatch => TokenKind::PrefixMatch,
            Token::SuffixMatch => TokenKind::SuffixMatch,
            Token::SubstringMatch => TokenKind::SubstringMatch,
            Token::Colon => TokenKind::Colon,
            Token::Semicolon => TokenKind::Semicolon,
            Token::Comma => TokenKind::Comma,
            Token::OpenSquare => TokenKind::OpenSquare,
            Token::CloseSquare => TokenKind::CloseSquare,
            Token::OpenParen => TokenKind::OpenParen,
            Token::CloseParen => TokenKind::CloseParen,
            Token::OpenCurly => TokenKind::OpenCurly,
            Token::CloseCurly => TokenKind::CloseCurly,
            Token::Comment(_) => TokenKind::Comment,
        }
    }

    #[inline]
    pub fn kind_string(&self) -> &'static str {
        self.kind().to_string()
    }

    pub fn raw(&self) -> &[u8] {
        match self {
            Token::Ident(v) => v,
            // .function => ...
            _ => unreachable!(),
        }
    }

    pub fn to_css_generic<W: WriteAll>(&self, writer: &mut W) -> Result<(), W::Error> {
        match self {
            Token::Ident(v) => serializer::serialize_identifier(v, writer),
            Token::AtKeyword(v) => {
                writer.write_all(b"@")?;
                serializer::serialize_identifier(v, writer)
            }
            Token::UnrestrictedHash(v) | Token::IdHash(v) => {
                writer.write_all(b"#")?;
                serializer::serialize_name(v, writer)
            }
            Token::QuotedString(x) => serializer::serialize_name(x, writer),
            Token::UnquotedUrl(x) => {
                writer.write_all(b"url(")?;
                serializer::serialize_unquoted_url(x, writer)?;
                writer.write_all(b")")
            }
            Token::Delim(x) => {
                debug_assert!(*x <= 0x7F);
                writer.write_byte(*x as u8)
            }
            Token::Number(n) => serializer::write_numeric(n.value, n.int_value, n.has_sign, writer),
            Token::Percentage { unit_value, int_value, has_sign } => {
                serializer::write_numeric(*unit_value * 100.0, *int_value, *has_sign, writer)?;
                writer.write_all(b"%")
            }
            Token::Dimension(d) => {
                serializer::write_numeric(d.num.value, d.num.int_value, d.num.has_sign, writer)?;
                // Disambiguate with scientific notation.
                let unit = d.unit;
                if (unit.len() == 1 && unit[0] == b'e')
                    || (unit.len() == 1 && unit[0] == b'E')
                    || unit.starts_with(b"e-")
                    || unit.starts_with(b"E-")
                {
                    writer.write_all(b"\\65 ")?;
                    serializer::serialize_name(&unit[1..], writer)
                } else {
                    serializer::serialize_identifier(unit, writer)
                }
            }
            Token::Whitespace(content) => writer.write_all(content),
            Token::Comment(content) => {
                writer.write_all(b"/*")?;
                writer.write_all(content)?;
                writer.write_all(b"*/")
            }
            Token::Colon => writer.write_all(b":"),
            Token::Semicolon => writer.write_all(b";"),
            Token::Comma => writer.write_all(b","),
            Token::IncludeMatch => writer.write_all(b"~="),
            Token::DashMatch => writer.write_all(b"|="),
            Token::PrefixMatch => writer.write_all(b"^="),
            Token::SuffixMatch => writer.write_all(b"$="),
            Token::SubstringMatch => writer.write_all(b"*="),
            Token::Cdo => writer.write_all(b"<!--"),
            Token::Cdc => writer.write_all(b"-->"),
            Token::Function(name) => {
                serializer::serialize_identifier(name, writer)?;
                writer.write_all(b"(")
            }
            Token::OpenParen => writer.write_all(b"("),
            Token::OpenSquare => writer.write_all(b"["),
            Token::OpenCurly => writer.write_all(b"{"),
            Token::BadUrl(contents) => {
                writer.write_all(b"url(")?;
                writer.write_all(contents)?;
                writer.write_byte(b')')
            }
            Token::BadString(value) => {
                writer.write_byte(b'"')?;
                let mut sw = serializer::CssStringWriter::new(writer);
                sw.write_str(value)
            }
            Token::CloseParen => writer.write_all(b")"),
            Token::CloseSquare => writer.write_all(b"]"),
            Token::CloseCurly => writer.write_all(b"}"),
        }
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            Token::Ident(value) => {
                serializer::serialize_identifier(value, dest).map_err(|_| dest.add_fmt_error())
            }
            Token::AtKeyword(value) => {
                dest.write_str("@")?;
                serializer::serialize_identifier(value, dest).map_err(|_| dest.add_fmt_error())
            }
            Token::UnrestrictedHash(value) => {
                dest.write_str("#")?;
                serializer::serialize_name(value, dest).map_err(|_| dest.add_fmt_error())
            }
            Token::IdHash(value) => {
                dest.write_str("#")?;
                serializer::serialize_identifier(value, dest).map_err(|_| dest.add_fmt_error())
            }
            Token::QuotedString(value) => {
                serializer::serialize_string(value, dest).map_err(|_| dest.add_fmt_error())
            }
            Token::UnquotedUrl(value) => {
                dest.write_str("url(")?;
                serializer::serialize_unquoted_url(value, dest)
                    .map_err(|_| dest.add_fmt_error())?;
                dest.write_str(")")
            }
            Token::Delim(value) => {
                debug_assert!(*value <= 0x7F);
                dest.write_char(*value as u8)
            }
            Token::Number(num) => serializer::write_numeric(num.value, num.int_value, num.has_sign, dest)
                .map_err(|_| dest.add_fmt_error()),
            Token::Percentage { unit_value, int_value, has_sign } => {
                serializer::write_numeric(*unit_value * 100.0, *int_value, *has_sign, dest)
                    .map_err(|_| dest.add_fmt_error())?;
                dest.write_str("%")
            }
            Token::Dimension(dim) => {
                serializer::write_numeric(dim.num.value, dim.num.int_value, dim.num.has_sign, dest)
                    .map_err(|_| dest.add_fmt_error())?;
                let unit = dim.unit;
                if unit == b"e" || unit == b"E" || unit.starts_with(b"e-") || unit.starts_with(b"E-")
                {
                    dest.write_str("\\65 ")?;
                    serializer::serialize_name(&unit[1..], dest)
                        .map_err(|_| dest.add_fmt_error())
                } else {
                    serializer::serialize_identifier(unit, dest)
                        .map_err(|_| dest.add_fmt_error())
                }
            }
            Token::Whitespace(content) => dest.write_bytes(content),
            Token::Comment(content) => {
                dest.write_str("/*")?;
                dest.write_bytes(content)?;
                dest.write_str("*/")
            }
            Token::Colon => dest.write_str(":"),
            Token::Semicolon => dest.write_str(";"),
            Token::Comma => dest.write_str(","),
            Token::IncludeMatch => dest.write_str("~="),
            Token::DashMatch => dest.write_str("|="),
            Token::PrefixMatch => dest.write_str("^="),
            Token::SuffixMatch => dest.write_str("$="),
            Token::SubstringMatch => dest.write_str("*="),
            Token::Cdo => dest.write_str("<!--"),
            Token::Cdc => dest.write_str("-->"),
            Token::Function(name) => {
                serializer::serialize_identifier(name, dest).map_err(|_| dest.add_fmt_error())?;
                dest.write_str("(")
            }
            Token::OpenParen => dest.write_str("("),
            Token::OpenSquare => dest.write_str("["),
            Token::OpenCurly => dest.write_str("{"),
            Token::BadUrl(contents) => {
                dest.write_str("url(")?;
                dest.write_bytes(contents)?;
                dest.write_char(b')')
            }
            Token::BadString(value) => {
                dest.write_char(b'"')?;
                let mut sw = serializer::CssStringWriter::new(dest);
                sw.write_str(value).map_err(|_| dest.add_fmt_error())
            }
            Token::CloseParen => dest.write_str(")"),
            Token::CloseSquare => dest.write_str("]"),
            Token::CloseCurly => dest.write_str("}"),
        }
    }
}

impl fmt::Display for Token {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Zig `pub fn format(this, writer)` — same body as `to_css_generic`
        // except `quoted_string` calls `serialize_string` and `idhash` calls
        // `serialize_identifier`. We delegate to a `core::fmt::Write` adapter.
        struct FmtAdapter<'a, 'b>(&'a mut fmt::Formatter<'b>);
        impl WriteAll for FmtAdapter<'_, '_> {
            type Error = fmt::Error;
            fn write_all(&mut self, buf: &[u8]) -> Result<(), fmt::Error> {
                // CSS source is arbitrary bytes (WTF-8 / latin-1); never validate
                // UTF-8 — Zig prints verbatim. bstr::BStr's Display escapes
                // non-UTF-8 bytes losslessly.
                self.0.write_fmt(format_args!("{}", bstr::BStr::new(buf)))
            }
            fn write_byte(&mut self, b: u8) -> Result<(), fmt::Error> {
                self.0.write_char(char::from(b))
            }
        }
        // TODO(port): Zig `format` had subtle differences from
        // `to_css_generic` (quoted_string→serialize_string,
        // idhash→serialize_identifier). Phase B specializes.
        self.to_css_generic(&mut FmtAdapter(f))
    }
}

/// Minimal byte-writer trait for `serializer` and `to_css_generic` (replaces
/// Zig `anytype` writer).
pub trait WriteAll {
    type Error;
    fn write_all(&mut self, buf: &[u8]) -> Result<(), Self::Error>;
    fn write_byte(&mut self, b: u8) -> Result<(), Self::Error> {
        self.write_all(&[b])
    }
}

#[derive(Clone, Copy)]
pub struct Num {
    pub has_sign: bool,
    pub value: f32,
    pub int_value: Option<i32>,
}

impl Num {
    pub fn eql(lhs: &Num, rhs: &Num) -> bool {
        generic::implement_eql(lhs, rhs)
    }
    pub fn hash(&self, hasher: &mut bun_wyhash::Wyhash) {
        generic::implement_hash(self, hasher)
    }
}

#[derive(Clone)]
pub struct Dimension {
    pub num: Num,
    /// e.g. "px"
    pub unit: &'static [u8], // TODO(port): lifetime
}

impl Dimension {
    pub fn eql(lhs: &Self, rhs: &Self) -> bool {
        generic::implement_eql(lhs, rhs)
    }
    pub fn hash(&self, hasher: &mut bun_wyhash::Wyhash) {
        generic::implement_hash(self, hasher)
    }
}

pub enum CopyOnWriteStr<'a> {
    Borrowed(&'a [u8]),
    Owned(bumpalo::collections::Vec<'a, u8>),
}

impl<'a> CopyOnWriteStr<'a> {
    pub fn append(&mut self, allocator: &'a Bump, slice: &[u8]) {
        match self {
            CopyOnWriteStr::Borrowed(b) => {
                let mut list =
                    bumpalo::collections::Vec::with_capacity_in(b.len() + slice.len(), allocator);
                list.extend_from_slice(b);
                list.extend_from_slice(slice);
                // PERF(port): was appendSliceAssumeCapacity
                *self = CopyOnWriteStr::Owned(list);
            }
            CopyOnWriteStr::Owned(o) => {
                o.extend_from_slice(slice);
            }
        }
    }

    pub fn to_slice(&self) -> &'a [u8] {
        match self {
            CopyOnWriteStr::Borrowed(b) => b,
            // SAFETY: bumpalo Vec storage is in the arena and outlives 'a.
            // TODO(port): bumpalo's `into_bump_slice()` is the proper API.
            CopyOnWriteStr::Owned(o) => unsafe {
                core::slice::from_raw_parts(o.as_ptr(), o.len())
            },
        }
    }
}

// ───────────────────────────── color ─────────────────────────────

pub mod color {
    use super::*;

    /// The opaque alpha value of 1.0.
    pub const OPAQUE: f32 = 1.0;

    #[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
    pub enum ColorError {
        #[error("parse")]
        Parse,
    }

    /// Either an angle or a number.
    pub enum AngleOrNumber {
        /// `<number>`.
        Number {
            /// The numeric value parsed, as a float.
            value: f32,
        },
        /// `<angle>`
        Angle {
            /// The value as a number of degrees.
            degrees: f32,
        },
    }

    pub type RGB = (u8, u8, u8);

    pub static NAMED_COLORS: phf::Map<&'static [u8], RGB> = phf::phf_map! {
        b"aliceblue" => (240, 248, 255),
        b"antiquewhite" => (250, 235, 215),
        b"aqua" => (0, 255, 255),
        b"aquamarine" => (127, 255, 212),
        b"azure" => (240, 255, 255),
        b"beige" => (245, 245, 220),
        b"bisque" => (255, 228, 196),
        b"black" => (0, 0, 0),
        b"blanchedalmond" => (255, 235, 205),
        b"blue" => (0, 0, 255),
        b"blueviolet" => (138, 43, 226),
        b"brown" => (165, 42, 42),
        b"burlywood" => (222, 184, 135),
        b"cadetblue" => (95, 158, 160),
        b"chartreuse" => (127, 255, 0),
        b"chocolate" => (210, 105, 30),
        b"coral" => (255, 127, 80),
        b"cornflowerblue" => (100, 149, 237),
        b"cornsilk" => (255, 248, 220),
        b"crimson" => (220, 20, 60),
        b"cyan" => (0, 255, 255),
        b"darkblue" => (0, 0, 139),
        b"darkcyan" => (0, 139, 139),
        b"darkgoldenrod" => (184, 134, 11),
        b"darkgray" => (169, 169, 169),
        b"darkgreen" => (0, 100, 0),
        b"darkgrey" => (169, 169, 169),
        b"darkkhaki" => (189, 183, 107),
        b"darkmagenta" => (139, 0, 139),
        b"darkolivegreen" => (85, 107, 47),
        b"darkorange" => (255, 140, 0),
        b"darkorchid" => (153, 50, 204),
        b"darkred" => (139, 0, 0),
        b"darksalmon" => (233, 150, 122),
        b"darkseagreen" => (143, 188, 143),
        b"darkslateblue" => (72, 61, 139),
        b"darkslategray" => (47, 79, 79),
        b"darkslategrey" => (47, 79, 79),
        b"darkturquoise" => (0, 206, 209),
        b"darkviolet" => (148, 0, 211),
        b"deeppink" => (255, 20, 147),
        b"deepskyblue" => (0, 191, 255),
        b"dimgray" => (105, 105, 105),
        b"dimgrey" => (105, 105, 105),
        b"dodgerblue" => (30, 144, 255),
        b"firebrick" => (178, 34, 34),
        b"floralwhite" => (255, 250, 240),
        b"forestgreen" => (34, 139, 34),
        b"fuchsia" => (255, 0, 255),
        b"gainsboro" => (220, 220, 220),
        b"ghostwhite" => (248, 248, 255),
        b"gold" => (255, 215, 0),
        b"goldenrod" => (218, 165, 32),
        b"gray" => (128, 128, 128),
        b"green" => (0, 128, 0),
        b"greenyellow" => (173, 255, 47),
        b"grey" => (128, 128, 128),
        b"honeydew" => (240, 255, 240),
        b"hotpink" => (255, 105, 180),
        b"indianred" => (205, 92, 92),
        b"indigo" => (75, 0, 130),
        b"ivory" => (255, 255, 240),
        b"khaki" => (240, 230, 140),
        b"lavender" => (230, 230, 250),
        b"lavenderblush" => (255, 240, 245),
        b"lawngreen" => (124, 252, 0),
        b"lemonchiffon" => (255, 250, 205),
        b"lightblue" => (173, 216, 230),
        b"lightcoral" => (240, 128, 128),
        b"lightcyan" => (224, 255, 255),
        b"lightgoldenrodyellow" => (250, 250, 210),
        b"lightgray" => (211, 211, 211),
        b"lightgreen" => (144, 238, 144),
        b"lightgrey" => (211, 211, 211),
        b"lightpink" => (255, 182, 193),
        b"lightsalmon" => (255, 160, 122),
        b"lightseagreen" => (32, 178, 170),
        b"lightskyblue" => (135, 206, 250),
        b"lightslategray" => (119, 136, 153),
        b"lightslategrey" => (119, 136, 153),
        b"lightsteelblue" => (176, 196, 222),
        b"lightyellow" => (255, 255, 224),
        b"lime" => (0, 255, 0),
        b"limegreen" => (50, 205, 50),
        b"linen" => (250, 240, 230),
        b"magenta" => (255, 0, 255),
        b"maroon" => (128, 0, 0),
        b"mediumaquamarine" => (102, 205, 170),
        b"mediumblue" => (0, 0, 205),
        b"mediumorchid" => (186, 85, 211),
        b"mediumpurple" => (147, 112, 219),
        b"mediumseagreen" => (60, 179, 113),
        b"mediumslateblue" => (123, 104, 238),
        b"mediumspringgreen" => (0, 250, 154),
        b"mediumturquoise" => (72, 209, 204),
        b"mediumvioletred" => (199, 21, 133),
        b"midnightblue" => (25, 25, 112),
        b"mintcream" => (245, 255, 250),
        b"mistyrose" => (255, 228, 225),
        b"moccasin" => (255, 228, 181),
        b"navajowhite" => (255, 222, 173),
        b"navy" => (0, 0, 128),
        b"oldlace" => (253, 245, 230),
        b"olive" => (128, 128, 0),
        b"olivedrab" => (107, 142, 35),
        b"orange" => (255, 165, 0),
        b"orangered" => (255, 69, 0),
        b"orchid" => (218, 112, 214),
        b"palegoldenrod" => (238, 232, 170),
        b"palegreen" => (152, 251, 152),
        b"paleturquoise" => (175, 238, 238),
        b"palevioletred" => (219, 112, 147),
        b"papayawhip" => (255, 239, 213),
        b"peachpuff" => (255, 218, 185),
        b"peru" => (205, 133, 63),
        b"pink" => (255, 192, 203),
        b"plum" => (221, 160, 221),
        b"powderblue" => (176, 224, 230),
        b"purple" => (128, 0, 128),
        b"rebeccapurple" => (102, 51, 153),
        b"red" => (255, 0, 0),
        b"rosybrown" => (188, 143, 143),
        b"royalblue" => (65, 105, 225),
        b"saddlebrown" => (139, 69, 19),
        b"salmon" => (250, 128, 114),
        b"sandybrown" => (244, 164, 96),
        b"seagreen" => (46, 139, 87),
        b"seashell" => (255, 245, 238),
        b"sienna" => (160, 82, 45),
        b"silver" => (192, 192, 192),
        b"skyblue" => (135, 206, 235),
        b"slateblue" => (106, 90, 205),
        b"slategray" => (112, 128, 144),
        b"slategrey" => (112, 128, 144),
        b"snow" => (255, 250, 250),
        b"springgreen" => (0, 255, 127),
        b"steelblue" => (70, 130, 180),
        b"tan" => (210, 180, 140),
        b"teal" => (0, 128, 128),
        b"thistle" => (216, 191, 216),
        b"tomato" => (255, 99, 71),
        b"turquoise" => (64, 224, 208),
        b"violet" => (238, 130, 238),
        b"wheat" => (245, 222, 179),
        b"white" => (255, 255, 255),
        b"whitesmoke" => (245, 245, 245),
        b"yellow" => (255, 255, 0),
        b"yellowgreen" => (154, 205, 50),
    };

    /// Returns the named color with the given name.
    /// <https://drafts.csswg.org/css-color-4/#typedef-named-color>
    pub fn parse_named_color(ident: &[u8]) -> Option<(u8, u8, u8)> {
        NAMED_COLORS.get(ident).copied()
    }

    /// Parse a color hash, without the leading '#' character.
    pub fn parse_hash_color(value: &[u8]) -> Option<(u8, u8, u8, f32)> {
        parse_hash_color_impl(value).ok()
    }

    pub fn parse_hash_color_impl(value: &[u8]) -> Result<(u8, u8, u8, f32), ColorError> {
        match value.len() {
            8 => Ok((
                from_hex(value[0])? * 16 + from_hex(value[1])?,
                from_hex(value[2])? * 16 + from_hex(value[3])?,
                from_hex(value[4])? * 16 + from_hex(value[5])?,
                (from_hex(value[6])? * 16 + from_hex(value[7])?) as f32 / 255.0,
            )),
            6 => {
                let r = from_hex(value[0])? * 16 + from_hex(value[1])?;
                let g = from_hex(value[2])? * 16 + from_hex(value[3])?;
                let b = from_hex(value[4])? * 16 + from_hex(value[5])?;
                Ok((r, g, b, OPAQUE))
            }
            4 => Ok((
                from_hex(value[0])? * 17,
                from_hex(value[1])? * 17,
                from_hex(value[2])? * 17,
                (from_hex(value[3])? * 17) as f32 / 255.0,
            )),
            3 => Ok((
                from_hex(value[0])? * 17,
                from_hex(value[1])? * 17,
                from_hex(value[2])? * 17,
                OPAQUE,
            )),
            _ => Err(ColorError::Parse),
        }
    }

    pub fn from_hex(c: u8) -> Result<u8, ColorError> {
        match c {
            b'0'..=b'9' => Ok(c - b'0'),
            b'a'..=b'f' => Ok(c - b'a' + 10),
            b'A'..=b'F' => Ok(c - b'A' + 10),
            _ => Err(ColorError::Parse),
        }
    }

    /// <https://drafts.csswg.org/css-color/#hsl-color> except with h
    /// pre-multiplied by 3, to avoid some rounding errors.
    pub fn hsl_to_rgb(hue: f32, saturation: f32, lightness: f32) -> (f32, f32, f32) {
        debug_assert!(saturation >= 0.0 && saturation <= 1.0);
        fn hue_to_rgb(m1: f32, m2: f32, mut h3: f32) -> f32 {
            if h3 < 0.0 {
                h3 += 3.0;
            }
            if h3 > 3.0 {
                h3 -= 3.0;
            }
            if h3 * 2.0 < 1.0 {
                m1 + (m2 - m1) * h3 * 2.0
            } else if h3 * 2.0 < 3.0 {
                m2
            } else if h3 < 2.0 {
                m1 + (m2 - m1) * (2.0 - h3) * 2.0
            } else {
                m1
            }
        }
        let m2 = if lightness <= 0.5 {
            lightness * (saturation + 1.0)
        } else {
            lightness + saturation - lightness * saturation
        };
        let m1 = lightness * 2.0 - m2;
        let hue_times_3 = hue * 3.0;
        let red = hue_to_rgb(m1, m2, hue_times_3 + 1.0);
        let green = hue_to_rgb(m1, m2, hue_times_3);
        let blue = hue_to_rgb(m1, m2, hue_times_3 - 1.0);
        (red, green, blue)
    }
}

// ───────────────────────────── serializer ─────────────────────────────

pub mod serializer {
    use super::*;

    /// Write a CSS name, like a custom property name.
    pub fn serialize_name<W: WriteAll>(value: &[u8], writer: &mut W) -> Result<(), W::Error> {
        let mut chunk_start: usize = 0;
        for (i, &b) in value.iter().enumerate() {
            let escaped: Option<&[u8]> = match b {
                b'0'..=b'9' | b'A'..=b'Z' | b'a'..=b'z' | b'_' | b'-' => continue,
                // the unicode replacement character
                0 => Some(strings::encode_utf8_comptime::<0xFFD>()),
                _ => {
                    if !b.is_ascii() {
                        continue;
                    }
                    None
                }
            };

            writer.write_all(&value[chunk_start..i])?;
            if let Some(esc) = escaped {
                writer.write_all(esc)?;
            } else if (b >= 0x01 && b <= 0x1F) || b == 0x7F {
                hex_escape(b, writer)?;
            } else {
                char_escape(b, writer)?;
            }
            chunk_start = i + 1;
        }
        writer.write_all(&value[chunk_start..])
    }

    /// Write a double-quoted CSS string token, escaping content as necessary.
    pub fn serialize_string<W: WriteAll>(value: &[u8], writer: &mut W) -> Result<(), W::Error> {
        writer.write_all(b"\"")?;
        let mut sw = CssStringWriter::new(writer);
        sw.write_str(value)?;
        writer.write_all(b"\"")
    }

    pub fn serialize_dimension(value: f32, unit: &[u8], dest: &mut Printer) -> Result<(), PrintErr> {
        let int_value: Option<i32> = if fract(value) == 0.0 {
            Some(value as i32) // saturating like Zig bun.intFromFloat
        } else {
            None
        };
        let token = Token::Dimension(Dimension {
            num: Num { has_sign: value < 0.0, value, int_value },
            unit,
        });
        if value != 0.0 && value.abs() < 1.0 {
            // TODO: calculate the actual number of chars here
            let mut buf = [0u8; 64];
            let mut fbs = FixedBufWriter::new(&mut buf);
            token.to_css_generic(&mut fbs).map_err(|_| dest.add_fmt_error())?;
            let s = fbs.buffered();
            if value < 0.0 {
                dest.write_str("-")?;
                dest.write_bytes(strings::trim_leading_pattern2(s, b'-', b'0'))
            } else {
                dest.write_bytes(strings::trim_leading_char(s, b'0'))
            }
        } else {
            token.to_css_generic(dest).map_err(|_| dest.add_fmt_error())
        }
    }

    /// Write a CSS identifier, escaping characters as necessary.
    pub fn serialize_identifier<W: WriteAll>(value: &[u8], writer: &mut W) -> Result<(), W::Error> {
        if value.is_empty() {
            return Ok(());
        }

        if value.starts_with(b"--") {
            writer.write_all(b"--")?;
            return serialize_name(&value[2..], writer);
        } else if value == b"-" {
            return writer.write_all(b"\\-");
        } else {
            let mut slice = value;
            if slice[0] == b'-' {
                writer.write_all(b"-")?;
                slice = &slice[1..];
            }
            if !slice.is_empty() && slice[0] >= b'0' && slice[0] <= b'9' {
                hex_escape(slice[0], writer)?;
                slice = &slice[1..];
            }
            serialize_name(slice, writer)
        }
    }

    pub fn serialize_unquoted_url<W: WriteAll>(value: &[u8], writer: &mut W) -> Result<(), W::Error> {
        let mut chunk_start: usize = 0;
        for (i, &b) in value.iter().enumerate() {
            let hex = match b {
                0..=b' ' | 0x7F => true,
                b'(' | b')' | b'"' | b'\'' | b'\\' => false,
                _ => continue,
            };
            writer.write_all(&value[chunk_start..i])?;
            if hex {
                hex_escape(b, writer)?;
            } else {
                char_escape(b, writer)?;
            }
            chunk_start = i + 1;
        }
        writer.write_all(&value[chunk_start..])
    }

    pub fn write_numeric<W: WriteAll>(
        value: f32,
        int_value: Option<i32>,
        has_sign: bool,
        writer: &mut W,
    ) -> Result<(), W::Error> {
        // `value >= 0` is true for negative 0.
        if has_sign && !value.is_sign_negative() {
            writer.write_all(b"+")?;
        }

        let notation: Notation = if value == 0.0 && value.is_sign_negative() {
            // Negative zero. Work around #20596.
            writer.write_all(b"-0")?;
            Notation { decimal_point: false, scientific: false }
        } else {
            let mut buf = [0u8; 129];
            let (str, maybe_notation) = dtoa_short(&mut buf, value, 6);
            writer.write_all(str)?;
            match maybe_notation {
                Some(n) => n,
                None => return Ok(()),
            }
        };

        if int_value.is_none() && fract(value) == 0.0 {
            if !notation.decimal_point && !notation.scientific {
                writer.write_all(b".0")?;
            }
        }

        Ok(())
    }

    pub fn hex_escape<W: WriteAll>(ascii_byte: u8, writer: &mut W) -> Result<(), W::Error> {
        const HEX_DIGITS: &[u8; 16] = b"0123456789abcdef";
        let mut bytes = [0u8; 4];
        let slice: &[u8] = if ascii_byte > 0x0F {
            let high = (ascii_byte >> 4) as usize;
            let low = (ascii_byte & 0x0F) as usize;
            bytes[0] = b'\\';
            bytes[1] = HEX_DIGITS[high];
            bytes[2] = HEX_DIGITS[low];
            bytes[3] = b' ';
            &bytes[0..4]
        } else {
            bytes[0] = b'\\';
            bytes[1] = HEX_DIGITS[ascii_byte as usize];
            bytes[2] = b' ';
            &bytes[0..3]
        };
        writer.write_all(slice)
    }

    pub fn char_escape<W: WriteAll>(ascii_byte: u8, writer: &mut W) -> Result<(), W::Error> {
        let bytes = [b'\\', ascii_byte];
        writer.write_all(&bytes)
    }

    pub struct CssStringWriter<'w, W: WriteAll> {
        inner: &'w mut W,
    }

    impl<'w, W: WriteAll> CssStringWriter<'w, W> {
        /// Wrap a text writer to create a `CssStringWriter`.
        pub fn new(inner: &'w mut W) -> Self {
            Self { inner }
        }

        pub fn write_str(&mut self, str: &[u8]) -> Result<(), W::Error> {
            let mut chunk_start: usize = 0;
            for (i, &b) in str.iter().enumerate() {
                let escaped: Option<&[u8]> = match b {
                    b'"' => Some(b"\\\""),
                    b'\\' => Some(b"\\\\"),
                    // replacement character
                    0 => Some(strings::encode_utf8_comptime::<0xFFD>()),
                    0x01..=0x1F | 0x7F => None,
                    _ => continue,
                };
                self.inner.write_all(&str[chunk_start..i])?;
                if let Some(e) = escaped {
                    self.inner.write_all(e)?;
                } else {
                    hex_escape(b, self.inner)?;
                }
                chunk_start = i + 1;
            }
            self.inner.write_all(&str[chunk_start..])
        }
    }

    /// Minimal fixed-buffer writer for `serialize_dimension`.
    pub struct FixedBufWriter<'a> {
        buf: &'a mut [u8],
        pos: usize,
    }
    impl<'a> FixedBufWriter<'a> {
        pub fn new(buf: &'a mut [u8]) -> Self {
            Self { buf, pos: 0 }
        }
        pub fn buffered(&self) -> &[u8] {
            &self.buf[..self.pos]
        }
    }
    impl<'a> WriteAll for FixedBufWriter<'a> {
        type Error = ();
        fn write_all(&mut self, src: &[u8]) -> Result<(), ()> {
            if self.pos + src.len() > self.buf.len() {
                return Err(());
            }
            self.buf[self.pos..self.pos + src.len()].copy_from_slice(src);
            self.pos += src.len();
            Ok(())
        }
    }
}

// ───────────────────────────── misc utilities ─────────────────────────────

pub mod parse_utility {
    use super::*;

    /// Parse a value from a string.
    ///
    /// NOTE: `input` should live as long as the returned value. Otherwise,
    /// strings in the returned parsed value will point to undefined memory.
    pub fn parse_string<T>(
        input: &[u8],
        parse_one: fn(&mut Parser) -> CssResult<T>,
    ) -> CssResult<T> {
        // I hope this is okay
        let mut import_records = BabyList::<ImportRecord>::default();
        let mut i = ParserInput::new(input);
        let mut parser = Parser::new(&mut i, Some(&mut import_records), ParserOpts::default(), None);
        let result = parse_one(&mut parser)?;
        parser.expect_exhausted()?;
        Ok(result)
    }
}

pub mod to_css {
    use super::*;

    /// Serialize `self` in CSS syntax and return a string.
    pub fn string<T: generic::ToCss>(
        this: &T,
        options: PrinterOptions,
        import_info: Option<ImportInfo>,
        local_names: Option<&LocalsResultsMap>,
        symbols: &bun_js_parser::ast::symbol::Map,
    ) -> Result<Vec<u8>, PrintErr> {
        let mut s: Vec<u8> = Vec::new();
        // PERF: think about how cheap this is to create
        let mut printer =
            Printer::new(Vec::new(), &mut s, options, import_info, local_names, symbols);
        // TODO(port): Zig special-cased `T == CSSString` → `CSSStringFns.toCss`.
        this.to_css(&mut printer)?;
        Ok(s)
    }

    pub fn from_list<T: generic::ToCss>(this: &[T], dest: &mut Printer) -> Result<(), PrintErr> {
        let len = this.len();
        for (idx, val) in this.iter().enumerate() {
            val.to_css(dest)?;
            if idx < len - 1 {
                dest.delim(b',', false)?;
            }
        }
        Ok(())
    }

    pub fn from_baby_list<T: generic::ToCss>(
        this: &BabyList<T>,
        dest: &mut Printer,
    ) -> Result<(), PrintErr> {
        let len = this.len();
        for (idx, val) in this.slice_const().iter().enumerate() {
            val.to_css(dest)?;
            if u32::try_from(idx).unwrap() < len - 1 {
                dest.delim(b',', false)?;
            }
        }
        Ok(())
    }

    pub fn integer<T: itoa::Integer>(this: T, dest: &mut Printer) -> Result<(), PrintErr> {
        let mut buf = itoa::Buffer::new();
        let str = buf.format(this);
        dest.write_str(str)
    }

    pub fn float32(this: f32, writer: &mut Printer) -> Result<(), PrintErr> {
        let mut scratch = [0u8; 129];
        let (str, _) = dtoa_short(&mut scratch, this, 6);
        writer.write_bytes(str)
    }

    // `maxDigits` was a comptime helper for the integer buffer size; replaced
    // by `itoa::Buffer` above.
}

/// Parse `!important`.
pub fn parse_important(input: &mut Parser) -> CssResult<()> {
    input.expect_delim(b'!')?;
    input.expect_ident_matching(b"important")
}

pub mod signfns {
    #[inline]
    pub fn is_sign_positive(x: f32) -> bool {
        !is_sign_negative(x)
    }
    #[inline]
    pub fn is_sign_negative(x: f32) -> bool {
        // SAFETY: This is just transmuting to get the sign bit, it's fine.
        x.to_bits() & 0x8000_0000 != 0
    }
    /// Returns a number that represents the sign of `self`.
    pub fn signum(x: f32) -> f32 {
        if x.is_nan() {
            return f32::NAN;
        }
        super::copysign(1.0, x)
    }

    #[inline]
    pub fn sign_f32(x: f32) -> f32 {
        if x == 0.0 {
            return if is_sign_negative(x) { 0.0 } else { -0.0 };
        }
        signum(x)
    }
}

/// Copies the sign of `sign` to `self`, returning a new f32 value.
#[inline]
pub fn copysign(self_: f32, sign: f32) -> f32 {
    let self_bits = self_.to_bits();
    let sign_bits = sign.to_bits();
    let result_bits = (self_bits & 0x7FFFFFFF) | (sign_bits & 0x80000000);
    f32::from_bits(result_bits)
}

pub fn deep_clone<V: generic::DeepClone>(list: &Vec<V>) -> Vec<V> {
    let mut newlist = Vec::with_capacity(list.len());
    for item in list {
        newlist.push(item.deep_clone());
        // PERF(port): was appendAssumeCapacity
    }
    newlist
}

pub fn deep_deinit<V>(_list: &mut Vec<V>) {
    // Rust: Drop handles this — fields drop recursively. No-op.
}

#[derive(Clone, Copy)]
pub struct Notation {
    pub decimal_point: bool,
    pub scientific: bool,
}

impl Notation {
    pub fn integer() -> Notation {
        Notation { decimal_point: false, scientific: false }
    }
}

/// Writes float with precision. Returns `None` notation if value was infinite.
pub fn dtoa_short(buf: &mut [u8; 129], value: f32, precision: u8) -> (&[u8], Option<Notation>) {
    // We can't give Infinity/-Infinity to dtoa_short_impl. We need to print a
    // valid finite number otherwise browsers like Safari will render certain
    // things wrong (https://github.com/oven-sh/bun/issues/18064).
    if value.is_infinite() && value.is_sign_positive() {
        const S: &[u8] = b"3.40282e38";
        buf[..S.len()].copy_from_slice(S);
        return (&buf[..S.len()], None);
    } else if value.is_infinite() && value.is_sign_negative() {
        const S: &[u8] = b"-3.40282e38";
        buf[..S.len()].copy_from_slice(S);
        return (&buf[..S.len()], None);
    }
    // We shouldn't receive NaN here.
    debug_assert!(!value.is_nan());
    let (str, notation) = dtoa_short_impl(buf, value, precision);
    (str, Some(notation))
}

pub fn dtoa_short_impl(buf: &mut [u8; 129], value: f32, precision: u8) -> (&[u8], Notation) {
    buf[0] = b'0';
    debug_assert!(value.is_finite());
    let buf_len = bun_core::fmt::FormatDouble::dtoa(&mut buf[1..], value as f64).len();
    restrict_prec(&mut buf[0..buf_len + 1], precision)
}

fn restrict_prec(buf: &mut [u8], prec: u8) -> (&[u8], Notation) {
    let len: u8 = u8::try_from(buf.len()).unwrap();

    // Put a leading zero to capture any carry. Caller must prepare an empty
    // byte for us.
    debug_assert!(buf[0] == b'0');
    buf[0] = b'0';
    // Remove the sign for now. We will put it back at the end.
    let sign = match buf[1] {
        b'+' | b'-' => {
            let s = buf[1];
            buf[1] = b'0';
            Some(s)
        }
        _ => None,
    };

    // Locate dot, exponent, and the first significant digit.
    let mut _pos_dot: Option<u8> = None;
    let mut pos_exp: Option<u8> = None;
    let mut _prec_start: Option<u8> = None;
    for i in 1..len {
        if buf[i as usize] == b'.' {
            debug_assert!(_pos_dot.is_none());
            _pos_dot = Some(i);
        } else if buf[i as usize] == b'e' {
            pos_exp = Some(i);
            // We don't change exponent part, so stop here.
            break;
        } else if _prec_start.is_none() && buf[i as usize] != b'0' {
            debug_assert!(buf[i as usize] >= b'1' && buf[i as usize] <= b'9');
            _prec_start = Some(i);
        }
    }

    let prec_start = if let Some(i) = _prec_start {
        i
    } else {
        // If there is no non-zero digit at all, it is just zero.
        return (&buf[0..1], Notation::integer());
    };

    // Coefficient part ends at 'e' or the length.
    let coeff_end = pos_exp.unwrap_or(len);
    // Decimal dot is effectively at the end of coefficient part if no dot
    // presents before that.
    let had_pos_dot = _pos_dot.is_some();
    let pos_dot = _pos_dot.unwrap_or(coeff_end);
    // Find the end position of the number within the given precision.
    let prec_end: u8 = {
        let end = prec_start + prec;
        if pos_dot > prec_start && pos_dot <= end { end + 1 } else { end }
    };
    let mut new_coeff_end = coeff_end;
    if prec_end < coeff_end {
        // Round to the given precision.
        let next_char = buf[prec_end as usize];
        new_coeff_end = prec_end;
        if next_char >= b'5' {
            let mut i = prec_end;
            while i != 0 {
                i -= 1;
                if buf[i as usize] == b'.' {
                    continue;
                }
                if buf[i as usize] != b'9' {
                    buf[i as usize] += 1;
                    new_coeff_end = i + 1;
                    break;
                }
                buf[i as usize] = b'0';
            }
        }
    }
    if new_coeff_end < pos_dot {
        // If the precision isn't enough to reach the dot, set all digits
        // in-between to zero and keep the number until the dot.
        for i in new_coeff_end..pos_dot {
            buf[i as usize] = b'0';
        }
        new_coeff_end = pos_dot;
    } else if had_pos_dot {
        // Strip any trailing zeros.
        let mut i = new_coeff_end;
        while i != 0 {
            i -= 1;
            if buf[i as usize] != b'0' {
                if buf[i as usize] == b'.' {
                    new_coeff_end = i;
                }
                break;
            }
            new_coeff_end = i;
        }
    }
    // Move exponent part if necessary.
    let real_end = if let Some(posexp) = pos_exp {
        let exp_len = len - posexp;
        if new_coeff_end != posexp {
            for i in 0..exp_len {
                buf[(new_coeff_end + i) as usize] = buf[(posexp + i) as usize];
            }
        }
        new_coeff_end + exp_len
    } else {
        new_coeff_end
    };
    // Add back the sign and strip the leading zero.
    let result: &[u8] = if let Some(sgn) = sign {
        if buf[1] == b'0' && buf[2] != b'.' {
            buf[1] = sgn;
            &buf[1..real_end as usize]
        } else {
            debug_assert!(buf[0] == b'0');
            buf[0] = sgn;
            &buf[0..real_end as usize]
        }
    } else {
        if buf[0] == b'0' && buf[1] != b'.' {
            &buf[1..real_end as usize]
        } else {
            &buf[0..real_end as usize]
        }
    };
    // Generate the notation info.
    let notation = Notation {
        decimal_point: pos_dot < new_coeff_end,
        scientific: pos_exp.is_some(),
    };
    (result, notation)
}

#[inline]
pub fn fract(val: f32) -> f32 {
    val - val.trunc()
}

pub fn f32_length_with_5_digits(n_input: f32) -> usize {
    let mut n = (n_input * 100000.0).round();
    let mut count: usize = 0;
    let mut i: usize = 0;

    while n >= 1.0 {
        let rem = n % 10.0;
        if i > 4 || rem != 0.0 {
            count += 1;
        }
        n /= 10.0;
        i += 1;
    }

    count
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/css_parser.zig (7329 lines)
//   confidence: low
//   todos:      65
//   notes:      heavy comptime reflection (DeriveParse/DeriveToCss/DefineShorthand) → trait stubs + #[derive] proc-macros; Token/Tokenizer slice payloads need <'a> threading; Parser sub-borrows alias ParserInput (raw-ptr or split-borrow in Phase B); ParserOptions.logger mutated through &self; pluck_imports mutates through &const; arena-fed ArrayLists demoted to heap Vec — PERF(port) markers added, Phase B threads &'bump Bump
// ──────────────────────────────────────────────────────────────────────────
