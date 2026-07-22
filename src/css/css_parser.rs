//! CSS parser.
//!
//! This is an AST crate (see PORTING.md §Allocators): allocations are
//! arena-backed, with `&'bump Bump` threaded where it matters.

use bun_alloc::ArenaVecExt as _;
use core::fmt;

use bun_alloc::Arena as Bump;
use bun_ast::Log;
use bun_collections::bit_set::{ArrayBitSet, num_masks_for};
use bun_collections::{ArrayHashMap, StringArrayHashMap, VecExt};
use bun_core::strings;

// ───────────────────────────── re-exports ─────────────────────────────
//
// Cross-module re-exports + parser core live here.

/// `bun.ast.Index` — bundler source-file index. Hoisted into
/// `bun_options_types` to keep css below the parser tier.
use bun_ast::Index as SrcIndex;
type SymbolList = Vec<bun_ast::Symbol>;
use bun_ast::{ImportKind, ImportRecord};

pub use crate::compat::{self, Feature};
pub use crate::css_modules::{self, Config as CssModuleConfig, CssModule};
pub use crate::dependencies;
pub use crate::error::{
    self as errors_, BasicParseError, BasicParseErrorKind, Err, ErrorLocation, MinifyErr,
    MinifyError, MinifyErrorKind, ParseError, ParserError, PrinterError, PrinterErrorKind,
    SelectorError,
};
pub use crate::generics::{self as generic, implement_deep_clone, implement_eql, implement_hash};
pub use crate::logical::{self, PropertyCategory};
pub use crate::prefixes;
pub use crate::printer::{self as css_printer, ImportInfo, Printer, PrinterOptions};
pub use crate::small_list::SmallList;
pub use crate::targets::{self, Features, Targets};

pub use crate::values::{
    self as css_values,
    color::CssColor,
    ident::{CustomIdent, CustomIdentList, DashedIdent, Ident},
};

// ── cross-module re-exports ──────────────────────────────────────────────
// Re-export the hub surfaces (rules/, selectors/, media_query, declaration,
// context, properties) so the rule-parser layer below can name
// `CssRule`/`SelectorList`/`DeclarationBlock` directly. `gated_shims` below
// carries the handful of types `AtRulePrelude` references that those hubs don't yet
// expose.
pub(crate) use crate::context::PropertyHandlerContext;
pub use crate::declaration::{self, DeclarationBlock, DeclarationHandler, DeclarationList};
pub use crate::media_query::{self, MediaFeatureType, MediaList};
pub use crate::properties::{
    self as css_properties, Property, PropertyId, PropertyIdTag,
    css_modules::Composes,
    custom::{TokenList, TokenListFns},
};
pub use crate::rules::custom_media::CustomMediaRule as CustomMedia;
pub use crate::rules::{
    self as css_rules, CssRule, CssRuleList, Location, MinifyContext, StyleContext,
    import::{ImportConditions, ImportRule},
    layer::{LayerBlockRule, LayerName, LayerStatementRule},
    namespace::NamespaceRule,
    style::StyleRule,
    supports::{SupportsCondition, SupportsRule},
    unknown::UnknownAtRule,
};
pub use crate::selectors::{
    parser::{Component, PseudoClass, PseudoElement, Selector, SelectorList},
    selector,
};
pub use crate::values::ident::{CustomIdentFns, DashedIdentFns, IdentFns};

pub use crate::values::{
    color::ColorFallbackKind,
    number::{CSSInteger, CSSIntegerFns, CSSNumber, CSSNumberFns},
    string::{CssString as CSSString, CssStringFns as CSSStringFns},
    url::Url,
};

pub use gated_shims::*;

/// Re-exports of leaf-module payload types `AtRulePrelude` names directly,
/// plus crate-tier shims for `bun.ast` types that live above this crate's
/// dependency tier.
mod gated_shims {

    // ── rules/ leaf-module payload re-exports ────────────────────────────
    // Re-export the prelude payload types `AtRulePrelude` carries so the
    // rule-parser impl bodies type-check against the same structs `CssRule`
    // stores.
    pub use crate::rules::container::{ContainerCondition, ContainerName};
    pub use crate::rules::keyframes::KeyframesName;
    pub use crate::rules::page::PageSelector;

    // ── ast crate-tier shims ─────────────────────────────────────────────
    /// `bun.ast.Ref` / `bun.ast.MangledProps` were re-exported via
    /// `bun_js_parser`; css sits below that tier. The real types were
    /// MOVE_DOWN'd into `bun_logger` (see logger/lib.rs:216).
    pub mod ast {
        pub use bun_ast::{Ref, RefTag};
        // Value type MUST match `bun_js_printer::MangledProps` exactly so the
        // bundler can pass `&LinkerContext.mangled_props` straight through —
        // the previous `*const [u8]` shim forced a `repr(Rust)` generic
        // type-pun (`ArrayHashMap<_, Box<[u8]>>` → `ArrayHashMap<_, *const [u8]>`)
        // whose layout equivalence the language does not guarantee.
        pub type MangledProps = bun_collections::ArrayHashMap<Ref, Box<[u8]>>;
        /// `bun.fs.Path` — `ImportRecord.path` field type. The
        /// real `bun.fs.Path` was MOVE_DOWN'd into `bun_paths::fs`.
        pub mod fs {
            pub use bun_paths::fs::Path;
            #[inline]
            pub(crate) fn path_init(text: &'static [u8]) -> Path<'static> {
                Path::init(text)
            }
        }
    }
}

pub use core::result::Result as Maybe;

// PrintErr is hoisted at crate root (single-variant `to_css` error signal);
// re-export so `css_parser::PrintErr` resolves for sibling modules.
pub use crate::PrintErr;

// ───────────────────────────── VendorPrefix ─────────────────────────────
// Data layout hoisted at crate root (lib.rs) so leaf modules (targets,
// prefixes) compile without the parser hub. Behavior impls live here.

pub use crate::VendorPrefix;

impl VendorPrefix {
    pub(crate) fn to_css(self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self.bits() {
            x if x == VendorPrefix::WEBKIT.bits() => dest.write_str("-webkit-"),
            x if x == VendorPrefix::MOZ.bits() => dest.write_str("-moz-"),
            x if x == VendorPrefix::MS.bits() => dest.write_str("-ms-"),
            x if x == VendorPrefix::O.bits() => dest.write_str("-o-"),
            _ => Ok(()),
        }
    }
}

// ───────────────────────────── SourceLocation ─────────────────────────────
// Data layout hoisted at crate root (lib.rs); error.rs / dependencies.rs
// reference `crate::SourceLocation` directly. Behavior impls live here.

pub use crate::SourceLocation;

impl SourceLocation {
    pub(crate) fn to_logger_location(self, file: &'static [u8]) -> bun_ast::Location {
        bun_ast::Location {
            file: std::borrow::Cow::Borrowed(file),
            line: i32::try_from(self.line).expect("int cast"),
            column: i32::try_from(self.column).expect("int cast"),
            ..Default::default()
        }
    }

    /// Create a new BasicParseError at this location for an unexpected token
    pub(crate) fn new_basic_unexpected_token_error(self, token: Token) -> ParseError<ParserError> {
        BasicParseError {
            kind: BasicParseErrorKind::unexpected_token(token),
            location: self,
        }
        .into_default_parse_error()
    }

    /// Create a new ParseError at this location for an unexpected token
    pub(crate) fn new_unexpected_token_error(self, token: Token) -> ParseError<ParserError> {
        ParseError {
            kind: errors_::ParserErrorKind::basic(BasicParseErrorKind::unexpected_token(token)),
            location: self,
        }
    }

    pub(crate) fn new_custom_error(self, err: impl IntoParserError) -> ParseError<ParserError> {
        ParseError {
            kind: errors_::ParserErrorKind::custom(err.into_parser_error()),
            location: self,
        }
    }
}

/// Dispatch trait for `SourceLocation::new_custom_error`.
pub trait IntoParserError {
    fn into_parser_error(self) -> ParserError;
}
impl IntoParserError for ParserError {
    #[inline]
    fn into_parser_error(self) -> ParserError {
        self
    }
}
// We intentionally do NOT impl `IntoParserError` for `BasicParseError` here:
// no caller ever passes one.
// `SelectorParseErrorKind` is impl'd in `selectors/parser.rs`.

pub type Error = Err<ParserError>;

pub type CssResult<T> = Maybe<T, ParseError<ParserError>>;

pub type PrintResult<T> = Maybe<T, PrinterError>;

#[cold]
pub(crate) fn todo(msg: &str) -> ! {
    bun_core::Global::features::TODO_PANIC.store(1, core::sync::atomic::Ordering::Relaxed);
    panic!("TODO: {msg}");
}

// ───────────────────────── Derive*-style helpers ─────────────────────────
//
// PORTING.md §Comptime reflection: each protocol is a trait
// (`ToCss`, `Parse`, `EnumProperty`, ...) and per-type impls are generated by
// a `#[derive(...)]` proc-macro. We declare the traits here and stub the
// helper bodies that callers in other files reference.

// Note: `DefineListShorthand` / `DefineRectShorthand` / `DefineSizeShorthand`
// / `DeriveParse` / `DeriveToCss` are
// proc-macros (`bun_css_derive::*`, re-exported below) plus the
// `impl_rect_shorthand!` / `impl_size_shorthand!` macros in
// `properties/margin_padding.rs`. The placeholder trait stubs that previously
// mirrored their `parse`/`to_css` signatures were dead (zero impls/bounds) and
// duplicated `generics::{Parse, ToCss}`, so they were removed.

/// `enum_property_util` — generic `parse`/`toCss`/`asStr` for plain enums.
pub(crate) mod enum_property_util {
    use super::*;

    pub(crate) fn as_str<T: Into<&'static str> + Copy>(this: &T) -> &'static str {
        (*this).into()
    }

    pub(crate) fn parse<T: EnumProperty>(input: &mut Parser) -> CssResult<T> {
        let location = input.current_source_location();
        let ident = input.expect_ident_cloned()?;
        if let Some(x) = T::from_ascii_case_insensitive(ident) {
            return Ok(x);
        }
        Err(location.new_unexpected_token_error(Token::Ident(ident)))
    }

    pub(crate) fn to_css<T: Into<&'static str> + Copy>(
        this: &T,
        dest: &mut Printer,
    ) -> Result<(), PrintErr> {
        dest.write_str(as_str(this).as_bytes())
    }
}

// Derive macros for the helpers above. Re-exported here as well as
// at crate root because some leaf modules alias `crate::css_parser as css`.
pub use bun_css_derive::{DefineEnumProperty, Parse, ToCss};

/// Keyword-enum CSS properties: case-insensitive parse from an ident plus a
/// canonical string form.
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
        let s: &'static str = (*self).into();
        dest.write_str(s.as_bytes())
    }

    #[inline]
    fn deep_clone(&self) -> Self {
        *self
    }

    fn hash(&self, hasher: &mut bun_wyhash::Wyhash)
    where
        Self: Into<u32>,
    {
        // The hash value never leaves the process, so a fixed u32 tag width is fine.
        let tag: u32 = (*self).into();
        hasher.update(&tag.to_ne_bytes());
    }
}

// ───────────────────────── core parse helpers ─────────────────────────

/// Skips to the end of the current block. Returns `true` if the matching
/// closing token was found, `false` if the end of input was reached first
/// (the block is unclosed).
#[cold]
fn consume_until_end_of_block(block_type: BlockType, tokenizer: &mut Tokenizer) -> bool {
    // Vec is fine for the cold path.
    let mut stack: Vec<BlockType> = Vec::with_capacity(16);
    stack.push(block_type);

    while let Ok(tok) = tokenizer.next() {
        if let Some(b) = BlockType::closing(&tok) {
            if *stack.last().unwrap() == b {
                let _ = stack.pop();
                if stack.is_empty() {
                    return true;
                }
            }
        }
        if let Some(bt) = BlockType::opening(&tok) {
            stack.push(bt);
        }
    }
    false
}

fn parse_at_rule<P: AtRuleParser>(
    start: &ParserState,
    name: &[u8],
    input: &mut Parser,
    parser: &mut P,
) -> CssResult<P::AtRule> {
    let delimiters = Delimiters::SEMICOLON | Delimiters::CURLY_BRACKET;
    let prelude: P::Prelude = match input.parse_until_before(delimiters, |input2: &mut Parser| {
        P::parse_prelude(parser, name, input2)
    }) {
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
                errors_::ParserErrorKind::basic(BasicParseErrorKind::at_rule_invalid(_))
            ) {
                // do nothing
            } else {
                return Err(input.new_custom_error(ParserError::at_rule_prelude_invalid));
            }
        }
    }

    // TODO: lifetime — `name` borrows the input arena. The detach is the
    // same `'static` erasure already applied to `Token`/`AtRulePrelude::Unknown`.
    // SAFETY: `name` points into the parser's source/arena, which outlives every
    // `AtRulePrelude`/warning produced from this parser (see `src_str`).
    let name: &'static [u8] = unsafe { src_str(name) };
    options.warn(&input.new_error(BasicParseErrorKind::at_rule_invalid(name)));
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
            //   _ => input.new_error(BasicParseErrorKind::at_rule_body_invalid),
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
    let prelude_result = input.parse_until_before(delimiters, |i| P::parse_prelude(parser, i));
    input.expect_curly_bracket_block()?;
    let prelude = prelude_result?;
    parse_nested_block(input, |input2| {
        P::parse_block(parser, prelude, start, input2)
    })
}

fn parse_until_before<T, C>(
    parser: &mut Parser,
    delimiters_: Delimiters,
    error_behavior: ParseUntilErrorBehavior,
    closure: C,
    parse_fn: impl FnOnce(C, &mut Parser) -> CssResult<T>,
) -> CssResult<T> {
    let delimiters = parser.stop_before | delimiters_;
    // `&'a mut ParserInput<'a>` is invariant and cannot be reborrowed into a
    // second `Parser<'a>` while the first lives, so temporarily swap
    // `stop_before` on the *same* Parser, run the inner parse, and restore.
    // `at_start_of` is moved into the inner parse — since we reuse the same
    // Parser it carries through unchanged, and is consumed/cleared below
    // rather than restored.
    let saved_stop_before = parser.stop_before;
    parser.stop_before = delimiters;
    let result = {
        let result = parser.parse_entirely(closure, parse_fn);
        if matches!(error_behavior, ParseUntilErrorBehavior::Stop) && result.is_err() {
            parser.stop_before = saved_stop_before;
            // Explicitly clear `at_start_of` so the caller doesn't observe a
            // stale block-start left behind by the failing inner parse.
            parser.at_start_of = None;
            return result;
        }
        if let Some(block_type) = parser.at_start_of.take() {
            consume_until_end_of_block(block_type, &mut parser.input.tokenizer);
        }
        result
    };
    parser.stop_before = saved_stop_before;

    // FIXME: have a special-purpose tokenizer method for this that does less work.
    loop {
        if delimiters.intersects(Delimiters::from_byte(parser.input.tokenizer.next_byte())) {
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

pub(crate) fn parse_until_after<T, C>(
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
    if next_byte.is_some()
        && !parser
            .stop_before
            .intersects(Delimiters::from_byte(next_byte))
    {
        debug_assert!(delimiters.intersects(Delimiters::from_byte(next_byte)));
        // We know this byte is ASCII.
        parser.input.tokenizer.advance(1);
        if next_byte == Some(b'{') {
            consume_until_end_of_block(BlockType::CurlyBracket, &mut parser.input.tokenizer);
        }
    }
    result
}

const MAX_NESTING_DEPTH: u32 = 512;

/// Records that the block whose content starts at `start_position` failed to
/// parse and turned out to be unclosed: the end of input was reached without
/// ever finding its closing token. See `ParserInput::unclosed_block_at_eof`.
#[cold]
fn record_unclosed_block_at_eof(parser: &mut Parser, start_position: usize) {
    debug_assert!(parser.input.tokenizer.is_eof());
    let eof_state = parser.input.tokenizer.state();
    let entry = parser
        .input
        .unclosed_block_at_eof
        .get_or_insert(UnclosedBlockAtEof {
            start_position,
            eof_state,
        });
    if start_position < entry.start_position {
        entry.start_position = start_position;
    }
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

    let start_position = parser.input.tokenizer.get_position();
    // If a block at or before this position already failed to parse and was
    // found to be unclosed at the end of input, this block lies inside that
    // truncated suffix and extends to the end of input as well. Re-parsing it
    // can only fail again, so skip straight to the end of input. Without this,
    // backtracking callers (e.g. `Calc::parse` followed by `V::parse`, or the
    // token-list color fallbacks) re-parse the unclosed suffix once per
    // alternative per nesting level, which is exponential in the nesting depth.
    if let Some(unclosed) = parser.input.unclosed_block_at_eof {
        if start_position >= unclosed.start_position {
            parser.input.tokenizer.reset(&unclosed.eof_state);
            return Err(parser.new_error(BasicParseErrorKind::end_of_input));
        }
    }

    parser.input.nesting_depth += 1;
    if parser.input.nesting_depth > MAX_NESTING_DEPTH {
        parser.input.nesting_depth -= 1;
        let err = parser.new_custom_error(ParserError::maximum_nesting_depth);
        let found_close = consume_until_end_of_block(block_type, &mut parser.input.tokenizer);
        if !found_close {
            record_unclosed_block_at_eof(parser, start_position);
        }
        return Err(err);
    }

    let closing_delimiter = match block_type {
        BlockType::CurlyBracket => Delimiters::CLOSE_CURLY_BRACKET,
        BlockType::SquareBracket => Delimiters::CLOSE_SQUARE_BRACKET,
        BlockType::Parenthesis => Delimiters::CLOSE_PARENTHESIS,
    };
    // Note: reshaped for borrowck — same aliasing as parse_until_before.
    // Swap stop_before/at_start_of in place rather than constructing a second
    // Parser over the invariant `&'a mut ParserInput<'a>`.
    let saved_stop_before = parser.stop_before;
    parser.stop_before = closing_delimiter;
    parser.at_start_of = None;
    let result = parser.parse_entirely((), |(), p| parsefn(p));
    if let Some(block_type2) = parser.at_start_of.take() {
        consume_until_end_of_block(block_type2, &mut parser.input.tokenizer);
    }
    parser.stop_before = saved_stop_before;
    let found_close = consume_until_end_of_block(block_type, &mut parser.input.tokenizer);
    if result.is_err() && !found_close {
        record_unclosed_block_at_eof(parser, start_position);
    }
    parser.input.nesting_depth -= 1;
    result
}

// ───────────────────────── parser-protocol traits ─────────────────────────

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

#[derive(Default, Clone, Copy, crate::DeepClone)]
pub struct DefaultAtRule;

impl DefaultAtRule {
    pub fn to_css(self, dest: &mut Printer) -> Result<(), PrintErr> {
        dest.new_error(PrinterErrorKind::fmt_error, None)
    }
    pub fn deep_clone(self) -> Self {
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
    fn push_to_enclosing_layer(this: &mut Self, name: LayerName);
    fn reset_enclosing_layer(this: &mut Self, len: u32);
    fn bump_anon_layer_count(this: &mut Self, amount: i32);

    /// Move the registered `@layer` names accumulated via `on_layer_rule` out
    /// of the parser. Only `BundlerAtRuleParser` populates
    /// `StyleSheet.layer_names`; this is a trait hook with a
    /// default no-op for parsers that don't track layers.
    fn take_layer_names(_this: &mut Self) -> Vec<LayerName> {
        Vec::new()
    }
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
        Err(input.new_error(BasicParseErrorKind::at_rule_invalid(name)))
    }

    fn parse_block(
        _this: &mut Self,
        _: (),
        _: &ParserState,
        input: &mut Parser,
        _: &ParserOptions,
        _: bool,
    ) -> CssResult<DefaultAtRule> {
        Err(input.new_error(BasicParseErrorKind::at_rule_body_invalid))
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
    fn enclosing_layer_length(_this: &mut Self) -> u32 {
        0
    }
    fn push_to_enclosing_layer(_this: &mut Self, _: LayerName) {}
    fn reset_enclosing_layer(_this: &mut Self, _: u32) {}
    fn bump_anon_layer_count(_this: &mut Self, _: i32) {}
}

pub type BundlerAtRule = DefaultAtRule;

pub struct BundlerAtRuleParser<'a> {
    pub(crate) arena: &'a Bump,
    /// Raw pointer aliasing the same `Vec` that `Parser.import_records`
    /// points to. Both views are raw pointers sharing a single
    /// SharedRW provenance (see `parse_bundler`); each materialises a
    /// short-lived `&mut` only at the point of use, so accesses interleave
    /// soundly under Stacked Borrows.
    pub(crate) import_records: *mut Vec<ImportRecord>,
    pub(crate) layer_names: Vec<LayerName>,
    /// Having _named_ layers nested inside of an _anonymous_ layer has no
    /// effect. See: https://drafts.csswg.org/css-cascade-5/#example-787042b6
    pub(crate) anon_layer_count: u32,
    pub(crate) enclosing_layer: LayerName,
}

impl<'a> CustomAtRuleParser for BundlerAtRuleParser<'a> {
    type Prelude = ();
    type AtRule = BundlerAtRule;

    fn parse_prelude(
        _this: &mut Self,
        name: &[u8],
        input: &mut Parser,
        _: &ParserOptions,
    ) -> CssResult<Self::Prelude> {
        Err(input.new_error(BasicParseErrorKind::at_rule_invalid(name)))
    }

    fn parse_block(
        _this: &mut Self,
        _: (),
        _: &ParserState,
        input: &mut Parser,
        _: &ParserOptions,
        _: bool,
    ) -> CssResult<Self::AtRule> {
        Err(input.new_error(BasicParseErrorKind::at_rule_body_invalid))
    }

    fn rule_without_block(
        _this: &mut Self,
        _prelude: (),
        _: &ParserState,
        _: &ParserOptions,
        _: bool,
    ) -> Maybe<Self::AtRule, ()> {
        Err(())
    }

    fn on_import_rule(
        this: &mut Self,
        import_rule: &mut ImportRule,
        start_position: u32,
        end_position: u32,
    ) {
        // SAFETY: `import_records` shares raw-pointer provenance with
        // `Parser.import_records` (see field doc / `parse_bundler`). This hook
        // runs synchronously between parser accesses, so the fresh `&mut`
        // created here is the only live reference for its scope.
        let import_records = unsafe { &mut *this.import_records };
        let import_record_index = u32::try_from(import_records.len()).unwrap();
        import_rule.import_record_idx = import_record_index;
        import_records.push(ImportRecord {
            path: ast::fs::path_init(import_rule.url),
            kind: if import_rule.supports.is_some() {
                ImportKind::AtConditional
            } else {
                ImportKind::At
            },
            range: bun_ast::Range {
                loc: bun_ast::Loc {
                    start: i32::try_from(start_position).expect("int cast"),
                },
                len: i32::try_from(end_position - start_position).expect("int cast"),
            },
            // NOTE: `ImportRecord` deliberately has no `Default` (range/path/kind
            // are required); spell out the remaining defaults explicitly.
            tag: Default::default(),
            loader: None,
            source_index: Default::default(),
            original_path: b"",
            flags: Default::default(),
        });
    }

    fn on_layer_rule(this: &mut Self, layers: &SmallList<LayerName, 1>) {
        if this.anon_layer_count > 0 {
            return;
        }
        this.layer_names
            .ensure_unused_capacity(layers.len() as usize);
        for layer in layers.slice() {
            if this.enclosing_layer.v.len() > 0 {
                let mut cloned = LayerName {
                    v: SmallList::default(),
                };
                // `SmallList` has no public `reserve`, so two `append_slice`
                // calls each grow once.
                cloned.v.append_slice(this.enclosing_layer.v.slice());
                cloned.v.append_slice(layer.v.slice());
                this.layer_names.append_assume_capacity(cloned);
            } else {
                this.layer_names
                    .append_assume_capacity(layer.deep_clone(this.arena));
            }
        }
    }

    fn enclosing_layer_length(this: &mut Self) -> u32 {
        this.enclosing_layer.v.len()
    }

    fn push_to_enclosing_layer(this: &mut Self, name: LayerName) {
        this.enclosing_layer.v.append_slice(name.v.slice());
    }

    fn take_layer_names(this: &mut Self) -> Vec<LayerName> {
        core::mem::take(&mut this.layer_names)
    }

    fn reset_enclosing_layer(this: &mut Self, len: u32) {
        this.enclosing_layer.v.set_len(len);
    }

    fn bump_anon_layer_count(this: &mut Self, amount: i32) {
        if amount > 0 {
            this.anon_layer_count += u32::try_from(amount).expect("int cast");
        } else {
            this.anon_layer_count -= amount.unsigned_abs();
        }
    }
}

// ───────────────────────────── AtRulePrelude ─────────────────────────────
//
// The leaf-module payload types (KeyframesName, PageSelector, ContainerName,
// ContainerCondition) are re-exported from `rules/` via `gated_shims` above.

pub enum AtRulePrelude<T> {
    FontFace,
    FontFeatureValues,
    FontPaletteValues(DashedIdent),
    CounterStyle(CustomIdent),
    Import {
        url: &'static [u8], // TODO: lifetime — arena-owned slice
        media: MediaList,
        supports: Option<SupportsCondition>,
        layer: Option<Option<LayerName>>,
    },
    Namespace {
        prefix: Option<&'static [u8]>, // TODO: lifetime
        url: &'static [u8],            // TODO: lifetime
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
        name: KeyframesName,
        prefix: VendorPrefix,
    },
    Page(Vec<PageSelector>),
    MozDocument,
    Layer(SmallList<LayerName, 1>),
    Container {
        name: Option<ContainerName>,
        condition: ContainerCondition,
    },
    StartingStyle,
    Nest(SelectorList),
    Scope {
        scope_start: Option<SelectorList>,
        scope_end: Option<SelectorList>,
    },
    Unknown {
        name: &'static [u8], // TODO: lifetime
        /// The tokens of the prelude
        tokens: TokenList,
    },
    Custom(T),
}

impl<T> AtRulePrelude<T> {
    pub(crate) fn allowed_in_style_rule(&self) -> bool {
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
    // `DeclarationList = bumpalo::Vec<'bump, Property>` needs the arena up
    // front, so cache it here (same `'static`-erased borrow `DeclarationBlock`
    // already uses crate-wide).
    pub(crate) arena: &'a Bump,
    pub(crate) options: &'a ParserOptions<'a>,
    pub(crate) state: TopLevelState,
    pub(crate) at_rule_parser: &'a mut AtRuleParserT,
    // TODO: think about memory management
    pub(crate) rules: &'a mut CssRuleList<AtRuleParserT::AtRule>,
    pub(crate) composes: &'a mut ComposesMap,
    pub(crate) composes_refs: SmallList<ast::Ref, 2>,
    pub(crate) local_properties: &'a mut LocalPropertyUsage,
}

impl<'a, AtRuleParserT: CustomAtRuleParser> TopLevelRuleParser<'a, AtRuleParserT> {
    pub(crate) fn new(
        arena: &'a Bump,
        options: &'a ParserOptions<'a>,
        at_rule_parser: &'a mut AtRuleParserT,
        rules: &'a mut CssRuleList<AtRuleParserT::AtRule>,
        composes: &'a mut ComposesMap,
        local_properties: &'a mut LocalPropertyUsage,
    ) -> Self {
        Self {
            arena,
            options,
            state: TopLevelState::Start,
            at_rule_parser,
            rules,
            composes,
            composes_refs: SmallList::default(),
            local_properties,
        }
    }

    pub(crate) fn nested(&mut self) -> NestedRuleParser<'_, AtRuleParserT> {
        // SAFETY: same `'static` erasure used by `DeclarationBlock::parse` —
        // the arena outlives every `DeclarationList` produced here.
        let bump: &'static Bump = unsafe { bun_ptr::detach_lifetime_ref(self.arena) };
        NestedRuleParser {
            arena: self.arena,
            options: self.options,
            at_rule_parser: &mut *self.at_rule_parser,
            declarations: DeclarationList::new_in(bump),
            important_declarations: DeclarationList::new_in(bump),
            rules: &mut *self.rules,
            is_in_style_rule: false,
            allow_declarations: false,
            composes_state: ComposesState::DisallowEntirely,
            composes: &mut *self.composes,
            composes_refs: &mut self.composes_refs,
            local_properties: &mut *self.local_properties,
        }
    }
}

// ───────────────────────────── NestedRuleParser ─────────────────────────────

#[derive(Clone, Copy)]
pub enum ComposesState {
    Allow(SourceLocation),
    DisallowNested(SourceLocation),
    DisallowNotSingleClass(SourceLocation),
    DisallowEntirely,
}

/// Dispatch trait for `parse_declaration_impl`. Implemented by `NestedRuleParser`.
pub trait ComposesCtx {
    fn composes_state(&self) -> ComposesState;
    fn record_composes(&mut self, composes: &mut Composes);
}
/// Unit `ComposesCtx` for callers that don't track `composes:`.
pub struct NoComposesCtx;
impl ComposesCtx for NoComposesCtx {
    #[inline]
    fn composes_state(&self) -> ComposesState {
        ComposesState::DisallowEntirely
    }
    #[inline]
    fn record_composes(&mut self, _: &mut Composes) {}
}

pub struct NestedRuleParser<'a, T: CustomAtRuleParser> {
    pub(crate) arena: &'a Bump,
    pub(crate) options: &'a ParserOptions<'a>,
    pub(crate) at_rule_parser: &'a mut T,
    // todo_stuff.think_mem_mgmt
    // Note: `DeclarationList<'bump>` borrows the parser arena. Threading
    // `'bump` here cascades into every rule type; deferred (matches
    // `StyleRule`'s `'static` erasure in rules/style.rs).
    pub(crate) declarations: DeclarationList<'static>,
    // todo_stuff.think_mem_mgmt
    pub(crate) important_declarations: DeclarationList<'static>,
    // todo_stuff.think_mem_mgmt
    pub(crate) rules: &'a mut CssRuleList<T::AtRule>,
    pub(crate) is_in_style_rule: bool,
    pub(crate) allow_declarations: bool,

    pub(crate) composes_state: ComposesState,
    pub(crate) composes_refs: &'a mut SmallList<ast::Ref, 2>,
    pub(crate) composes: &'a mut ComposesMap,
    pub(crate) local_properties: &'a mut LocalPropertyUsage,
}

impl<'a, T: CustomAtRuleParser> NestedRuleParser<'a, T> {
    pub(crate) fn get_loc(&self, start: &ParserState) -> Location {
        let loc = start.source_location();
        Location {
            source_index: self.options.source_index,
            line: loc.line,
            column: loc.column,
        }
    }
}

// ───────────────────── DeclarationParser / RuleBodyItemParser ────────────────

pub trait DeclarationParser {
    type Declaration;
    fn parse_value(
        this: &mut Self,
        name: &[u8],
        input: &mut Parser,
    ) -> CssResult<Self::Declaration>;
}

pub trait RuleBodyItemParser: AtRuleParser + QualifiedRuleParser + DeclarationParser {
    fn parse_qualified(this: &Self) -> bool;
    fn parse_declarations(this: &Self) -> bool;
}

// ───────────────────────────── StyleSheetParser ─────────────────────────────

pub(crate) struct StyleSheetParser<'i, 't, P: AtRuleParser + QualifiedRuleParser> {
    pub(crate) input: &'i mut Parser<'t>,
    pub(crate) parser: &'i mut P,
    pub(crate) any_rule_so_far: bool,
}

impl<'i, 't, P> StyleSheetParser<'i, 't, P>
where
    P: AtRuleParser + QualifiedRuleParser<QualifiedRule = <P as AtRuleParser>::AtRule>,
{
    pub(crate) fn new(input: &'i mut Parser<'t>, parser: &'i mut P) -> Self {
        Self {
            input,
            parser,
            any_rule_so_far: false,
        }
    }

    pub(crate) fn next(&mut self) -> Option<CssResult<<P as AtRuleParser>::AtRule>> {
        loop {
            self.input.skip_cdc_and_cdo();

            let start = self.input.state();
            let at_keyword: Option<&[u8]> = match self.input.next_byte()? {
                b'@' => 'brk: {
                    let at_keyword: &Token =
                        match self.input.next_including_whitespace_and_comments() {
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
                    let _ = self
                        .input
                        .parse_until_after(delimiters, Parser::parse_empty);
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

// ───────────────────── rule_parsers (heavy impl bodies) ──────────────────────
mod rule_parsers {
    use super::*;
    use crate::selectors::parser as selector_parser;

    // The borrow checker forbids passing `&mut *this` while also borrowing
    // `this.declarations` / `this.important_declarations`, so split-borrow the
    // three composes fields into a small adaptor that implements the
    // `ComposesCtx` dispatch trait.
    struct NestedComposesCtx<'a> {
        state: ComposesState,
        arena: &'a Bump,
        composes: &'a mut ComposesMap,
        composes_refs: &'a mut SmallList<ast::Ref, 2>,
    }
    impl<'a> ComposesCtx for NestedComposesCtx<'a> {
        #[inline]
        fn composes_state(&self) -> ComposesState {
            self.state
        }
        fn record_composes(&mut self, composes: &mut Composes) {
            for ref_ in self.composes_refs.slice() {
                let entry = self.composes.entry(*ref_).or_default();
                entry.composes.push(composes.deep_clone(self.arena));
            }
        }
    }

    impl<'a, AtRuleParserT: CustomAtRuleParser> AtRuleParser for TopLevelRuleParser<'a, AtRuleParserT> {
        type Prelude = AtRulePrelude<AtRuleParserT::Prelude>;
        type AtRule = ();

        fn parse_prelude(
            this: &mut Self,
            name: &[u8],
            input: &mut Parser,
        ) -> CssResult<Self::Prelude> {
            // Case-insensitive dispatch on at-rule name.
            crate::match_ignore_ascii_case! { name, {
                b"import" => {
                    if (this.state as u8) > (TopLevelState::Imports as u8) {
                        return Err(input.new_custom_error(ParserError::unexpected_import_rule));
                    }
                    // TODO: lifetime — arena-owned slice; same `'static` erasure
                    // as `Token` payloads.
                    // SAFETY: the returned slice borrows `input.src`/arena, which outlives
                    // the `AtRulePrelude` it is stored in (see `src_str`).
                    let url_str: &'static [u8] = unsafe { src_str(input.expect_url_or_string()?) };

                    let layer: Option<Option<LayerName>> =
                        if input.try_parse(|p| p.expect_ident_matching(b"layer")).is_ok() {
                            Some(None)
                        } else if input.try_parse(|p| p.expect_function_matching(b"layer")).is_ok() {
                            Some(Some(input.parse_nested_block(LayerName::parse)?))
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

                    let media = parse_media_list(input, this.options)?;

                    return Ok(AtRulePrelude::Import { url: url_str, media, supports, layer });
                },
                b"namespace" => {
                    if (this.state as u8) > (TopLevelState::Namespaces as u8) {
                        return Err(input.new_custom_error(ParserError::unexpected_namespace_rule));
                    }
                    let prefix = input
                        .try_parse(|p| {
                            p.expect_ident().map(|s| -> &'static [u8] {
                                // SAFETY: `s` borrows the parser's source/arena, which
                                // outlives the `AtRulePrelude` it is stored in (see
                                // `src_str`).
                                unsafe { src_str(s) }
                            })
                        })
                        .ok();
                    // SAFETY: the returned slice borrows `input.src`/arena, which outlives
                    // the `AtRulePrelude` it is stored in (see `src_str`).
                    let namespace: &'static [u8] = unsafe { src_str(input.expect_url_or_string()?) };
                    return Ok(AtRulePrelude::Namespace { prefix, url: namespace });
                },
                b"charset" => {
                    // @charset is removed by rust-cssparser if it's the first rule in
                    // the stylesheet. Anything left is technically invalid, however,
                    // users often concatenate CSS files together, so we are more
                    // lenient and simply ignore @charset rules in the middle of a file.
                    input.expect_string()?;
                    return Ok(AtRulePrelude::Charset);
                },
                b"custom-media" => {
                    let custom_media_name = DashedIdentFns::parse(input)?;
                    let media = parse_media_list(input, this.options)?;
                    return Ok(AtRulePrelude::CustomMedia { name: custom_media_name, media });
                },
                b"property" => {
                    let property_name = DashedIdentFns::parse(input)?;
                    return Ok(AtRulePrelude::Property { name: property_name });
                },
                _ => {},
            } }

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
                AtRulePrelude::Import {
                    url,
                    media,
                    supports,
                    layer,
                } => {
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
                        u32::try_from(start.position).expect("int cast"),
                        u32::try_from(start.position + 1).expect("int cast"),
                    );
                    this.rules.v.push(CssRule::Import(import_rule));
                    Ok(())
                }
                AtRulePrelude::Namespace { prefix, url } => {
                    this.state = TopLevelState::Namespaces;
                    this.rules.v.push(CssRule::Namespace(NamespaceRule {
                        prefix: prefix.map(|p| Ident {
                            v: std::ptr::from_ref::<[u8]>(p),
                        }),
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
                layer @ AtRulePrelude::Layer(_) => {
                    if (this.state as u8) <= (TopLevelState::Layers as u8) {
                        this.state = TopLevelState::Layers;
                    } else {
                        this.state = TopLevelState::Body;
                    }
                    let mut nested_parser = this.nested();
                    <NestedRuleParser<'_, AtRuleParserT> as AtRuleParser>::rule_without_block(
                        &mut nested_parser,
                        layer,
                        start,
                    )
                }
                AtRulePrelude::Charset => Ok(()),
                AtRulePrelude::Unknown {
                    name,
                    tokens: prelude2,
                } => {
                    this.rules.v.push(CssRule::Unknown(UnknownAtRule {
                        name,
                        prelude: prelude2,
                        block: None,
                        loc,
                    }));
                    Ok(())
                }
                custom @ AtRulePrelude::Custom(_) => {
                    this.state = TopLevelState::Body;
                    let mut nested_parser = this.nested();
                    <NestedRuleParser<'_, AtRuleParserT> as AtRuleParser>::rule_without_block(
                        &mut nested_parser,
                        custom,
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

    // ── NestedRuleParser behavior (struct hoisted above) ─────────────────────────

    impl<'a, T: CustomAtRuleParser> NestedRuleParser<'a, T> {
        pub(crate) fn parse_nested(
            &mut self,
            input: &mut Parser,
            is_style_rule: bool,
        ) -> CssResult<(DeclarationBlock<'static>, CssRuleList<T::AtRule>)> {
            // TODO: think about memory management in error cases
            let mut rules = CssRuleList::<T::AtRule>::default();
            let composes_state = if self.is_in_style_rule
                && matches!(self.composes_state, ComposesState::Allow(_))
            {
                let ComposesState::Allow(l) = self.composes_state else {
                    unreachable!()
                };
                ComposesState::DisallowNested(l)
            } else {
                // ComposesState is Copy.
                self.composes_state
            };
            // SAFETY: see `TopLevelRuleParser::nested` — `'static` erasure of the
            // parser arena.
            let bump: &'static Bump = unsafe { bun_ptr::detach_lifetime_ref(self.arena) };
            let mut nested_parser = NestedRuleParser::<T> {
                arena: self.arena,
                options: self.options,
                at_rule_parser: &mut *self.at_rule_parser,
                declarations: DeclarationList::new_in(bump),
                important_declarations: DeclarationList::new_in(bump),
                rules: &mut rules,
                is_in_style_rule: self.is_in_style_rule || is_style_rule,
                allow_declarations: self.allow_declarations
                    || self.is_in_style_rule
                    || is_style_rule,
                composes_state,
                composes: &mut *self.composes,
                composes_refs: &mut *self.composes_refs,
                local_properties: &mut *self.local_properties,
            };
            // Spell out the impl with a fresh lifetime so `nested_parser` isn't
            // forced to borrow `rules` for `'a`.
            let parse_declarations =
                <NestedRuleParser<'_, T> as RuleBodyItemParser>::parse_declarations(&nested_parser);
            // TODO: think about memory management
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
                            iter.parser.options.warn(&e);
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
                            self.options.warn(&e);
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

        pub(crate) fn parse_style_block(
            &mut self,
            input: &mut Parser,
        ) -> CssResult<CssRuleList<T::AtRule>> {
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
                        // Arena-backed: this StyleRule lands in arena AST; bulk-free won't run Drop.
                        selectors: SelectorList::from_selector(Selector::from_component_in(
                            Component::Nesting,
                            bun_alloc::ArenaPtr::new(input.arena()),
                        )),
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

        fn parse_prelude(
            this: &mut Self,
            name: &[u8],
            input: &mut Parser,
        ) -> CssResult<Self::Prelude> {
            // TODO: lifetime — `name` borrows the input arena. Detach to
            // `'static` to feed `BasicParseErrorKind::at_rule_invalid` (matches the
            // `Token` payload erasure throughout this file).
            // SAFETY: `name` points into the parser's source/arena, which outlives
            // every prelude/error produced from this parser (see `src_str`).
            let name: &'static [u8] = unsafe { src_str(name) };
            let result: Self::Prelude = 'brk: {
                crate::match_ignore_ascii_case! { name, {
                    b"media" => break 'brk AtRulePrelude::Media(parse_media_list(input, this.options)?),
                    b"supports" => break 'brk AtRulePrelude::Supports(SupportsCondition::parse(input)?),
                    b"font-face" => break 'brk AtRulePrelude::FontFace,
                    b"font-palette-values" => break 'brk AtRulePrelude::FontPaletteValues(DashedIdentFns::parse(input)?),
                    b"counter-style" => break 'brk AtRulePrelude::CounterStyle(CustomIdentFns::parse(input)?),
                    b"viewport" | b"-ms-viewport" => {
                        let prefix = VendorPrefix::strip_from(name).0;
                        break 'brk AtRulePrelude::Viewport(prefix);
                    },
                    b"keyframes" | b"-webkit-keyframes" | b"-moz-keyframes" | b"-o-keyframes" | b"-ms-keyframes" => {
                        let prefix = VendorPrefix::strip_from(name).0;
                        let keyframes_name =
                            input.try_parse(css_rules::keyframes::KeyframesName::parse)?;
                        break 'brk AtRulePrelude::Keyframes { name: keyframes_name, prefix };
                    },
                    b"page" => {
                        // EOF inside `PageSelector::parse`
                        // (e.g. `@page foo` with nothing after) propagates here and is
                        // swallowed by `try_parse`, yielding an empty list.
                        let selectors: Vec<PageSelector> = input
                            .try_parse(|input2| {
                                input2.parse_comma_separated(css_rules::page::PageSelector::parse)
                            })
                            .unwrap_or_default();
                        break 'brk AtRulePrelude::Page(selectors);
                    },
                    b"-moz-document" => {
                        // Firefox only supports the url-prefix() function with no
                        // arguments as a legacy CSS hack.
                        input.expect_function_matching(b"url-prefix")?;
                        input.parse_nested_block(|input2| {
                            // Firefox also allows an empty string as an argument...
                            let _ = input2.try_parse(|input2| -> CssResult<()> {
                                let s = input2.expect_string()?;
                                if !s.is_empty() {
                                    return Err(input2.new_custom_error(ParserError::invalid_value));
                                }
                                Ok(())
                            });
                            input2.expect_exhausted()
                        })?;
                        break 'brk AtRulePrelude::MozDocument;
                    },
                    b"layer" => {
                        let names: SmallList<LayerName, 1> =
                            match input.parse_comma_separated(LayerName::parse) {
                                Ok(vv) => SmallList::<LayerName, 1>::from_list(vv),
                                Err(e) => {
                                    if matches!(
                                        e.kind,
                                        errors_::ParserErrorKind::basic(BasicParseErrorKind::end_of_input)
                                    ) {
                                        SmallList::default()
                                    } else {
                                        return Err(e);
                                    }
                                }
                            };
                        break 'brk AtRulePrelude::Layer(names);
                    },
                    b"container" => {
                        let container_name: Option<ContainerName> =
                            input.try_parse(css_rules::container::ContainerName::parse).ok();
                        let condition: ContainerCondition =
                            css_rules::container::ContainerCondition::parse(input)?;
                        break 'brk AtRulePrelude::Container { name: container_name, condition };
                    },
                    b"starting-style" => break 'brk AtRulePrelude::StartingStyle,
                    b"scope" => {
                        let mut selector_parser = selector_parser::SelectorParser {
                            is_nesting_allowed: true,
                            options: this.options,
                        };
                        let scope_start = if input.try_parse(|p| p.expect_parenthesis_block()).is_ok() {
                            Some(input.parse_nested_block(|input2| {
                                SelectorList::parse_relative(
                                    &mut selector_parser,
                                    input2,
                                    selector_parser::ParseErrorRecovery::IgnoreInvalidSelector,
                                    selector_parser::NestingRequirement::None,
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
                                    selector_parser::ParseErrorRecovery::IgnoreInvalidSelector,
                                    selector_parser::NestingRequirement::None,
                                )
                            })?)
                        } else {
                            None
                        };
                        break 'brk AtRulePrelude::Scope { scope_start, scope_end };
                    },
                    b"nest" => if this.is_in_style_rule {
                        this.options.warn(&input.new_custom_error(ParserError::deprecated_nest_rule));
                        let mut selector_parser = selector_parser::SelectorParser {
                            is_nesting_allowed: true,
                            options: this.options,
                        };
                        let selectors = SelectorList::parse(
                            &mut selector_parser,
                            input,
                            selector_parser::ParseErrorRecovery::DiscardList,
                            selector_parser::NestingRequirement::Contained,
                        )?;
                        break 'brk AtRulePrelude::Nest(selectors);
                    },
                    _ => {},
                } }

                parse_custom_at_rule_prelude(name, input, this.options, this.at_rule_parser)?
            };

            if this.is_in_style_rule && !result.allowed_in_style_rule() {
                return Err(input.new_error(BasicParseErrorKind::at_rule_invalid(name)));
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
                    let mut decl_parser = css_rules::font_face::FontFaceDeclarationParser;
                    let mut parser = RuleBodyParser::new(input, &mut decl_parser);
                    // todo_stuff.think_mem_mgmt
                    let mut properties: Vec<css_rules::font_face::FontFaceProperty> = Vec::new();
                    while let Some(result) = parser.next() {
                        if let Ok(decl) = result {
                            properties.push(decl);
                        }
                    }
                    this.rules
                        .v
                        .push(CssRule::FontFace(css_rules::font_face::FontFaceRule {
                            properties,
                            loc,
                        }));
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
                    this.rules
                        .v
                        .push(CssRule::Media(css_rules::media::MediaRule {
                            query,
                            rules,
                            loc,
                        }));
                    Ok(())
                }
                AtRulePrelude::Supports(condition) => {
                    let rules = this.parse_style_block(input)?;
                    this.rules
                        .v
                        .push(CssRule::Supports(css_rules::supports::SupportsRule {
                            condition,
                            rules,
                            loc,
                        }));
                    Ok(())
                }
                AtRulePrelude::Container { name, condition } => {
                    let rules = this.parse_style_block(input)?;
                    this.rules
                        .v
                        .push(CssRule::Container(css_rules::container::ContainerRule {
                            name,
                            condition,
                            rules,
                            loc,
                        }));
                    Ok(())
                }
                AtRulePrelude::Scope {
                    scope_start,
                    scope_end,
                } => {
                    let rules = this.parse_style_block(input)?;
                    this.rules
                        .v
                        .push(CssRule::Scope(css_rules::scope::ScopeRule {
                            scope_start,
                            scope_end,
                            rules,
                            loc,
                        }));
                    Ok(())
                }
                AtRulePrelude::Viewport(vendor_prefix) => {
                    this.rules
                        .v
                        .push(CssRule::Viewport(css_rules::viewport::ViewportRule {
                            vendor_prefix,
                            declarations: DeclarationBlock::parse(input, this.options)?,
                            loc,
                        }));
                    Ok(())
                }
                AtRulePrelude::Keyframes { name, prefix } => {
                    let mut parser = css_rules::keyframes::KeyframesListParser;
                    let mut iter = RuleBodyParser::new(input, &mut parser);
                    // todo_stuff.think_mem_mgmt
                    let mut keyframes: Vec<css_rules::keyframes::Keyframe> = Vec::new();
                    while let Some(result) = iter.next() {
                        if let Ok(keyframe) = result {
                            keyframes.push(keyframe);
                        }
                    }
                    this.rules
                        .v
                        .push(CssRule::Keyframes(css_rules::keyframes::KeyframesRule {
                            name,
                            keyframes,
                            vendor_prefix: prefix,
                            loc,
                        }));
                    Ok(())
                }
                AtRulePrelude::Page(selectors) => {
                    let rule =
                        css_rules::page::PageRule::parse(selectors, input, loc, this.options)?;
                    this.rules.v.push(CssRule::Page(rule));
                    Ok(())
                }
                AtRulePrelude::MozDocument => {
                    let rules = this.parse_style_block(input)?;
                    this.rules
                        .v
                        .push(CssRule::MozDocument(css_rules::document::MozDocumentRule {
                            rules,
                            loc,
                        }));
                    Ok(())
                }
                AtRulePrelude::Layer(mut layer) => {
                    // Clone slot 0 for the rule's `name` (leaving the list
                    // intact so the `on_layer_rule` hook still observes the
                    // 1-element list), fire `on_layer_rule`, then
                    // drain the original into `push_to_enclosing_layer`.
                    let name = if layer.len() == 0 {
                        None
                    } else if layer.len() == 1 {
                        // `LayerName` has no `Clone` impl yet; `deep_clone` is the
                        // arena-threaded shallow copy (segments are arena-borrowed
                        // `&[u8]`).
                        Some(layer.at(0).deep_clone(this.arena))
                    } else {
                        return Err(input.new_error(BasicParseErrorKind::at_rule_body_invalid));
                    };

                    T::on_layer_rule(this.at_rule_parser, &layer);
                    let old_len = T::enclosing_layer_length(this.at_rule_parser);
                    if name.is_some() {
                        // Drain the sole element by value — avoids a second clone.
                        T::push_to_enclosing_layer(this.at_rule_parser, layer.swap_remove(0));
                    } else {
                        T::bump_anon_layer_count(this.at_rule_parser, 1);
                    }

                    let rules = this.parse_style_block(input)?;

                    if name.is_none() {
                        T::bump_anon_layer_count(this.at_rule_parser, -1);
                    }
                    T::reset_enclosing_layer(this.at_rule_parser, old_len);

                    this.rules
                        .v
                        .push(CssRule::LayerBlock(css_rules::layer::LayerBlockRule {
                            name,
                            rules,
                            loc,
                        }));
                    Ok(())
                }
                AtRulePrelude::Property { name } => {
                    let rule = css_rules::property::PropertyRule::parse(name, input, loc)?;
                    this.rules.v.push(CssRule::Property(rule));
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
                    this.rules
                        .v
                        .push(CssRule::Nesting(css_rules::nesting::NestingRule {
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
                    this.rules
                        .v
                        .push(CssRule::LayerStatement(LayerStatementRule {
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
            let mut selector_parser = selector_parser::SelectorParser {
                is_nesting_allowed: true,
                options: this.options,
            };
            if this.is_in_style_rule {
                SelectorList::parse_relative(
                    &mut selector_parser,
                    input,
                    selector_parser::ParseErrorRecovery::DiscardList,
                    selector_parser::NestingRequirement::Implicit,
                )
            } else {
                SelectorList::parse(
                    &mut selector_parser,
                    input,
                    selector_parser::ParseErrorRecovery::DiscardList,
                    selector_parser::NestingRequirement::None,
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
            // `composes_refs` is `&mut SmallList<..>` borrowed from the parent
            // `TopLevelRuleParser`, so dropping `NestedRuleParser` on an error path
            // does NOT clear the underlying storage. A safe `scopeguard::guard`
            // over `&mut *this.composes_refs` would hold that borrow across
            // `this.parse_nested(&mut self, …)` and trip borrowck, so capture the
            // raw pointer instead — the guard fires at scope exit after all body
            // borrows of `this` are released, and the pointee (owned by the parent
            // `TopLevelRuleParser`) strictly outlives this frame.
            let composes_refs_ptr: *mut SmallList<ast::Ref, 2> = &raw mut *this.composes_refs;
            scopeguard::defer! {
                // SAFETY: see the note above — no aliasing borrow live at drop.
                unsafe { (*composes_refs_ptr).clear_retaining_capacity(); }
            }
            // allow composes if:
            // - NOT in nested style rules
            // - AND there is only one class selector
            if input.flags.css_modules() {
                'out: {
                    if this.is_in_style_rule {
                        this.composes_state = ComposesState::DisallowNested(SourceLocation {
                            line: loc.line,
                            column: loc.column,
                        });
                        break 'out;
                    }
                    if selectors.v.len() != 1 {
                        this.composes_state =
                            ComposesState::DisallowNotSingleClass(SourceLocation {
                                line: loc.line,
                                column: loc.column,
                            });
                        break 'out;
                    }
                    let sel = &selectors.v.slice()[0];
                    if sel.components.len() != 1 {
                        this.composes_state =
                            ComposesState::DisallowNotSingleClass(SourceLocation {
                                line: loc.line,
                                column: loc.column,
                            });
                        break 'out;
                    }
                    let comp = &sel.components[0];
                    if let Some(r) = comp.as_class() {
                        let ref_ = r.as_ref().unwrap();
                        this.composes_refs.append(ref_);
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
                let mut usage = PropertyBitset::init_empty();
                let mut custom_properties: Vec<&'static [u8]> = Vec::new();
                fill_property_bit_set(&mut usage, &declarations, &mut custom_properties);

                let custom_properties_slice = custom_properties.slice();

                for ref_ in this.composes_refs.slice() {
                    let entry =
                        this.local_properties
                            .entry(*ref_)
                            .or_insert_with(|| PropertyUsage {
                                range: bun_ast::Range {
                                    loc: bun_ast::Loc {
                                        start: i32::try_from(location).expect("int cast"),
                                    },
                                    len: i32::try_from(len).expect("int cast"),
                                },
                                ..Default::default()
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

            Ok(())
        }
    }

    impl<'a, T: CustomAtRuleParser> RuleBodyItemParser for NestedRuleParser<'a, T> {
        fn parse_qualified(_this: &Self) -> bool {
            true
        }
        fn parse_declarations(this: &Self) -> bool {
            this.allow_declarations
        }
    }

    impl<'a, T: CustomAtRuleParser> DeclarationParser for NestedRuleParser<'a, T> {
        type Declaration = ();

        fn parse_value(this: &mut Self, name: &[u8], input: &mut Parser) -> CssResult<()> {
            // Note: split-borrow — see `NestedComposesCtx` above.
            // SAFETY: `input.arena()` re-borrows the parser arena through `&self`;
            // detach that borrow so `input` can be re-borrowed mutably below. The
            // arena outlives the parser (it owns all parsed allocations).
            let arena: &Bump = unsafe { bun_ptr::detach_lifetime_ref(input.arena()) };
            let mut ctx = NestedComposesCtx {
                state: this.composes_state,
                arena,
                composes: &mut *this.composes,
                composes_refs: &mut *this.composes_refs,
            };
            declaration::parse_declaration_impl(
                name,
                input,
                &mut this.declarations,
                &mut this.important_declarations,
                this.options,
                &mut ctx,
            )
        }
    }

    #[inline]
    fn parse_media_list(input: &mut Parser, options: &ParserOptions) -> CssResult<MediaList> {
        MediaList::parse(input, options)
    }
} // mod rule_parsers

/// The serialized CSS returned from `to_css`.
pub struct ToCssResult {
    /// Serialized CSS code.
    pub code: Vec<u8>,
}

#[derive(Default)]
pub struct MinifyOptions {
    /// Targets to compile the CSS for.
    pub targets: targets::Targets,
    /// A list of known unused symbols, including CSS class names, ids, and
    /// `@keyframe` names. The declarations of these will be removed.
    pub unused_symbols: ArrayHashMap<Box<[u8]>, ()>,
}

pub type BundlerStyleSheet = StyleSheet<BundlerAtRule>;
pub type BundlerCssRuleList = CssRuleList<BundlerAtRule>;
pub type BundlerCssRule = CssRule<BundlerAtRule>;
pub type BundlerLayerBlockRule = css_rules::layer::LayerBlockRule<BundlerAtRule>;
pub type BundlerSupportsRule = css_rules::supports::SupportsRule<BundlerAtRule>;
pub type BundlerMediaRule = css_rules::media::MediaRule<BundlerAtRule>;

/// Additional data we don't want stored on the stylesheet
#[derive(Default)]
pub struct StylesheetExtra {
    /// Used when css modules is enabled
    pub symbols: SymbolList,
}

pub struct ParserExtra {
    pub(crate) symbols: SymbolList,
    pub(crate) local_scope: LocalScope,
    pub(crate) source_index: SrcIndex,
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
    }
}

impl CssRef {
    const INNER_INDEX_BITS: u32 = 26;
    const INNER_INDEX_MASK: u32 = (1 << Self::INNER_INDEX_BITS) - 1;

    pub(crate) fn new(inner_index: u32, tag: CssRefTag) -> Self {
        debug_assert!(inner_index <= Self::INNER_INDEX_MASK);
        Self(inner_index | ((tag.bits() as u32) << Self::INNER_INDEX_BITS))
    }

    pub fn inner_index(self) -> u32 {
        self.0 & Self::INNER_INDEX_MASK
    }

    pub fn tag(self) -> CssRefTag {
        CssRefTag::from_bits_retain((self.0 >> Self::INNER_INDEX_BITS) as u8)
    }

    pub(crate) fn set_tag(&mut self, tag: CssRefTag) {
        self.0 = self.inner_index() | ((tag.bits() as u32) << Self::INNER_INDEX_BITS);
    }

    pub fn can_be_composed(self) -> bool {
        self.tag().contains(CssRefTag::CLASS)
    }

    pub fn to_real_ref(self, source_index: u32) -> bun_ast::Ref {
        bun_ast::Ref::new(self.inner_index(), source_index, bun_ast::RefTag::Symbol)
    }
}

#[derive(Default)]
pub struct LocalEntry {
    pub ref_: CssRef,
    pub loc: bun_ast::Loc,
}

/// If css modules is enabled, this maps locally scoped class names to their
/// ref. We use this ref as a layer of indirection during the bundling stage
/// because we don't know the final generated class names for local scope
/// until print time.
pub type LocalScope = StringArrayHashMap<LocalEntry>;
/// Local symbol renaming results go here
pub type LocalsResultsMap = ast::MangledProps;
/// Using `compose` and having conflicting properties is undefined behavior
/// according to the css modules spec. We should warn the user about this.
pub type LocalPropertyUsage = ArrayHashMap<bun_ast::Ref, PropertyUsage>;
pub type ComposesMap = ArrayHashMap<bun_ast::Ref, ComposesEntry>;

#[derive(Default)]
pub struct ComposesEntry {
    pub composes: Vec<Composes>,
}

pub struct PropertyUsage {
    pub bitset: PropertyBitset,
    pub custom_properties: Box<[&'static [u8]]>, // TODO: lifetime — arena slices
    pub range: bun_ast::Range,
}

impl Default for PropertyUsage {
    fn default() -> Self {
        Self {
            bitset: PropertyBitset::init_empty(),
            custom_properties: Box::default(),
            range: bun_ast::Range::default(),
        }
    }
}

impl PropertyUsage {
    #[inline]
    pub(crate) fn fill(&mut self, used: &PropertyBitset, custom_properties: &[&'static [u8]]) {
        self.bitset.set_union(used);
        // TODO: lifetime — box for now.
        self.custom_properties = custom_properties.to_vec().into_boxed_slice();
    }
}

// `PropertyIdTag` is a dense `repr(u16)` enum with no
// explicit discriminants whose last variant is `Custom`, so the variant count
// is `Custom + 1`.
pub const PROPERTY_BITSET_BITS: usize = (PropertyIdTag::Custom as usize + 1).next_power_of_two();
pub type PropertyBitset =
    ArrayBitSet<PROPERTY_BITSET_BITS, { num_masks_for(PROPERTY_BITSET_BITS) }>;

pub(crate) fn fill_property_bit_set(
    bitset: &mut PropertyBitset,
    block: &DeclarationBlock<'_>,
    custom_properties: &mut Vec<&'static [u8]>,
) {
    for prop in block.declarations.iter() {
        let tag = match prop {
            Property::Custom(c) => {
                // SAFETY: `'bump`-erasure — `CustomPropertyName` stores an
                // arena-owned `*const [u8]`; detach from `block`'s borrow so
                // callers can move `block` afterwards. Re-thread once
                // `PropertyUsage` carries the arena lifetime (TODO at field def).
                let name: &'static [u8] = unsafe { src_str(c.name.as_str()) };
                custom_properties.push(name);
                continue;
            }
            Property::Unparsed(u) => u.property_id.tag(),
            Property::Composes(_) => continue,
            _ => prop.property_id().tag(),
        };
        let int: u16 = tag as u16;
        bitset.set(int as usize);
    }
    for prop in block.important_declarations.iter() {
        let tag = match prop {
            Property::Custom(c) => {
                // SAFETY: see above.
                let name: &'static [u8] = unsafe { src_str(c.name.as_str()) };
                custom_properties.push(name);
                continue;
            }
            Property::Unparsed(u) => u.property_id.tag(),
            Property::Composes(_) => continue,
            _ => prop.property_id().tag(),
        };
        let int: u16 = tag as u16;
        bitset.set(int as usize);
    }
}

// ───────────────────────────── StyleSheet ─────────────────────────────
//
// `CssRuleList`/`LayerName`/`ParserOptions` carry the type surface; the
// behavior surface (`parse`/`minify`/`to_css`/`pluck_imports`) lives in
// `stylesheet_impl` below.

pub struct StyleSheet<AtRule> {
    /// A list of top-level rules within the style sheet.
    pub rules: CssRuleList<AtRule>,
    pub sources: Vec<Box<[u8]>>,
    pub source_map_urls: Vec<Option<Box<[u8]>>>,
    pub license_comments: Vec<&'static [u8]>, // TODO: lifetime — arena
    pub options: ParserOptions<'static>,      // TODO: lifetime
    pub layer_names: Vec<LayerName>,

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
            layer_names: Vec::new(),
            local_scope: LocalScope::default(),
            local_properties: LocalPropertyUsage::default(),
            composes: ComposesMap::default(),
        }
    }
}

// ── StyleSheet behavior (parse/minify/to_css) ────────────────────────────────
mod stylesheet_impl {
    use super::*;

    impl<AtRule> StyleSheet<AtRule> {
        /// Minify and transform the style sheet for the provided browser targets.
        ///
        /// Note: `arena` is the arena that owns this stylesheet's AST.
        /// It is threaded into `MinifyContext` so
        /// downstream `deep_clone` calls allocate alongside the existing tree.
        pub fn minify(
            &mut self,
            arena: &Bump,
            options: &MinifyOptions,
            extra: &StylesheetExtra,
        ) -> Maybe<(), Err<MinifyErrorKind>>
        where
            AtRule: for<'b> generic::DeepClone<'b>,
        {
            let ctx = PropertyHandlerContext::new(arena, &options.targets, &options.unused_symbols);
            let mut handler = DeclarationHandler::new(arena);
            let mut important_handler = DeclarationHandler::new(arena);

            // @custom-media rules may be defined after they are referenced, but
            // may only be defined at the top level of a stylesheet. Do a pre-scan
            // here and create a lookup table by name.
            let custom_media: Option<
                ArrayHashMap<Box<[u8]>, css_rules::custom_media::CustomMediaRule>,
            > = if self.options.flags.contains(ParserFlags::CUSTOM_MEDIA)
                && options
                    .targets
                    .should_compile_same(compat::Feature::CustomMediaQueries)
            {
                let mut custom_media = ArrayHashMap::default();
                for rule in self.rules.v.iter() {
                    if let CssRule::CustomMedia(cm) = rule {
                        let key: Box<[u8]> = cm.name.v().into();
                        custom_media.insert(key, cm.deep_clone(arena));
                    }
                }
                Some(custom_media)
            } else {
                None
            };

            let mut minify_ctx = MinifyContext {
                arena,
                targets: &options.targets,
                handler: &mut handler,
                important_handler: &mut important_handler,
                handler_context: ctx,
                unused_symbols: &options.unused_symbols,
                custom_media,
                css_modules: self.options.css_modules.is_some(),
                extra,
                err: None,
                selector_expansion_multiplier: 1,
                selector_expansion_total: 0,
            };

            if self.rules.minify(&mut minify_ctx, false).is_err() {
                // Rule-level minify signals failure with the unit `MinifyErr`
                // and records the diagnostic out-of-band on the context.
                debug_assert!(minify_ctx.err.is_some());
                let e = minify_ctx.err.take().unwrap_or_else(|| MinifyError {
                    kind: MinifyErrorKind::unknown,
                    loc: crate::Location::default(),
                });
                let filename: &[u8] = self
                    .sources
                    .get(e.loc.source_index as usize)
                    .map(|source| &**source)
                    .unwrap_or(self.options.filename);
                let minify_error = Err {
                    kind: e.kind,
                    loc: Some(ErrorLocation {
                        filename,
                        line: e.loc.line,
                        column: e.loc.column,
                    }),
                };
                return Err(minify_error);
            }

            Ok(())
        }

        pub fn to_css_with_writer<'a>(
            &'a self,
            arena: &'a Bump,
            writer: &'a mut dyn bun_io::Write,
            options: &PrinterOptions<'a>,
            import_info: Option<ImportInfo<'a>>,
            local_names: Option<&'a LocalsResultsMap>,
            symbols: &'a bun_ast::symbol::Map,
        ) -> PrintResult<()> {
            // Note: PrinterOptions has `&mut SourceMap` and so isn't Copy; capture
            // the lone field we re-read after moving `options` into Printer::new.
            let project_root = options.project_root;
            let mut printer = Printer::new(
                arena,
                bun_alloc::ArenaVec::new_in(arena),
                writer,
                options,
                import_info,
                local_names,
                symbols,
            );
            match self.to_css_with_writer_impl(&mut printer, project_root) {
                Ok(result) => Ok(result),
                Err(_) => {
                    debug_assert!(printer.error_kind.is_some());
                    Err(printer.error_kind.unwrap())
                }
            }
        }

        pub(crate) fn to_css_with_writer_impl<'a>(
            &'a self,
            printer: &mut Printer<'a>,
            project_root: Option<&[u8]>,
        ) -> Result<(), PrintErr> {
            // #[cfg(feature = "sourcemap")] { printer.sources = Some(&self.sources); }
            // #[cfg(feature = "sourcemap")] if printer.source_map.is_some() { ... }

            for comment in &self.license_comments {
                printer.write_str("/*")?;
                printer.write_comment(comment)?;
                printer.write_str("*/")?;
                printer.newline()?;
            }

            if let Some(config) = &self.options.css_modules {
                printer.css_module = Some(CssModule::new(
                    printer.arena,
                    config,
                    &self.sources,
                    project_root,
                ));
            }
            self.rules.to_css(printer)?;
            printer.newline()?;
            Ok(())
        }

        pub fn to_css<'a>(
            &'a self,
            arena: &'a Bump,
            options: &PrinterOptions<'a>,
            import_info: Option<ImportInfo<'a>>,
            local_names: Option<&'a LocalsResultsMap>,
            symbols: &'a bun_ast::symbol::Map,
        ) -> PrintResult<ToCssResult> {
            // TODO: this is not necessary
            // Make sure we always have capacity > 0: https://github.com/napi-rs/napi-rs/issues/1124.
            // PERF: this always heap-allocates — profile if hot.
            let mut dest: Vec<u8> = Vec::with_capacity(1);
            self.to_css_with_writer(arena, &mut dest, options, import_info, local_names, symbols)?;
            return Ok(ToCssResult { code: dest });
        }

        pub fn parse(
            arena: &'static Bump,
            code: &[u8],
            options: ParserOptions<'static>,
            import_records: Option<&mut Vec<ImportRecord>>,
            source_index: SrcIndex,
        ) -> Maybe<(StyleSheet<DefaultAtRule>, StylesheetExtra), Err<ParserError>> {
            // Returns the concrete `StyleSheet<DefaultAtRule>`. Callers that
            // need a custom at-rule call `parse_with` directly.
            let mut default_at_rule_parser = DefaultAtRuleParser;
            StyleSheet::<DefaultAtRule>::parse_with(
                arena,
                code,
                options,
                &mut default_at_rule_parser,
                import_records.map(core::ptr::NonNull::from),
                source_index,
            )
        }

        /// Parse a style sheet from a string.
        // TODO: `ParserOptions<'static>` matches the `StyleSheet.options`
        // field's `'static` erasure; re-threads to `<'bump>` alongside the rest of
        // the crate.
        pub(crate) fn parse_with<P: CustomAtRuleParser<AtRule = AtRule>>(
            arena: &'static Bump,
            code: &[u8],
            options: ParserOptions<'static>,
            at_rule_parser: &mut P,
            import_records: Option<core::ptr::NonNull<Vec<ImportRecord>>>,
            source_index: SrcIndex,
        ) -> Maybe<(Self, StylesheetExtra), Err<ParserError>> {
            // TODO: 'bump lifetime threading — every arena-backed slice the
            // parser hands back is currently detached to `'static` (matching the
            // crate-wide erasure on `DeclarationBlock<'static>`/`Token` payloads).
            // The caller owns the arena, so the storage outlives the
            // returned `StyleSheet`.
            // TODO(refactor): re-thread the lifetime through `CssRuleList<'bump, R>`
            // and drop the `'static` bound on `arena`.
            let mut composes = ComposesMap::default();
            let mut parser_extra = ParserExtra {
                local_scope: LocalScope::default(),
                symbols: SymbolList::default(),
                source_index,
            };
            let mut local_properties = LocalPropertyUsage::default();

            let mut input = ParserInput::new(code, arena);
            let mut parser = Parser::new(
                &mut input,
                import_records,
                if options.css_modules.is_some() {
                    ParserOpts::CSS_MODULES
                } else {
                    ParserOpts::empty()
                },
                Some(&mut parser_extra),
            );

            let mut license_comments: Vec<&'static [u8]> = Vec::new();
            let mut state = parser.state();
            while let Ok(token) = parser.next_including_whitespace_and_comments() {
                match *token {
                    Token::Whitespace(_) => {}
                    Token::Comment(comment) => {
                        if comment.first() == Some(&b'!') {
                            // TODO: lifetime — arena slice; see erasure note.
                            // SAFETY: `comment` borrows `parser.src`, which outlives
                            // `license_comments` (consumed before `parser` drops).
                            license_comments.push(unsafe { src_str(comment) });
                        }
                    }
                    _ => break,
                }
                state = parser.state();
            }
            parser.reset(&state);

            let mut rules = CssRuleList::<AtRule>::default();
            let mut rule_parser = TopLevelRuleParser::new(
                arena,
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

            let sources: Vec<Box<[u8]>> = vec![Box::<[u8]>::from(options.filename)];
            let source_map_urls: Vec<Option<Box<[u8]>>> =
                vec![parser.current_source_map_url().map(Box::<[u8]>::from)];

            // Dispatch through the `CustomAtRuleParser::take_layer_names` hook
            // (default = empty; `BundlerAtRuleParser` overrides to move its list
            // out) so the accumulated layer ordering isn't silently dropped.
            let layer_names = P::take_layer_names(at_rule_parser);

            Ok((
                Self {
                    rules,
                    sources,
                    source_map_urls,
                    license_comments,
                    options,
                    layer_names,
                    local_scope: parser_extra.local_scope,
                    local_properties,
                    composes,
                },
                StylesheetExtra {
                    symbols: parser_extra.symbols,
                },
            ))
        }
    }

    impl StyleAttribute {
        pub fn parse(
            arena: &'static Bump,
            code: &[u8],
            options: &ParserOptions,
            import_records: &mut Vec<ImportRecord>,
            source_index: SrcIndex,
        ) -> Maybe<StyleAttribute, Err<ParserError>> {
            // TODO: 'bump lifetime threading — `DeclarationBlock<'static>` in
            // `StyleAttribute` vs `Parser<'a>` here; `arena: &'static Bump`
            // matches the crate-wide erasure (see `parse_with`).
            let mut parser_extra = ParserExtra {
                local_scope: LocalScope::default(),
                symbols: SymbolList::default(),
                source_index,
            };
            let mut input = ParserInput::new(code, arena);
            let mut parser = Parser::new(
                &mut input,
                Some(core::ptr::NonNull::from(import_records)),
                if options.css_modules.is_some() {
                    ParserOpts::CSS_MODULES
                } else {
                    ParserOpts::empty()
                },
                Some(&mut parser_extra),
            );
            let sources: Vec<Box<[u8]>> = vec![options.filename.into()];
            Ok(StyleAttribute {
                declarations: match DeclarationBlock::parse(&mut parser, options) {
                    Ok(v) => v,
                    Err(e) => return Err(Err::from_parse_error(e, b"")),
                },
                sources,
            })
        }

        pub fn to_css<'a>(
            &'a self,
            arena: &'a Bump,
            options: &PrinterOptions<'a>,
            import_info: Option<ImportInfo<'a>>,
        ) -> Result<ToCssResult, PrintErr> {
            // #[cfg(feature = "sourcemap")]
            // assert!(
            //   options.source_map.is_none(),
            //   "Source maps are not supported for style attributes"
            // );

            let symbols = bun_ast::symbol::Map::init_list(Default::default());
            let mut dest: Vec<u8> = Vec::new();
            let mut printer = Printer::new(
                arena,
                bun_alloc::ArenaVec::new_in(arena),
                &mut dest,
                options,
                import_info,
                None,
                &symbols,
            );
            printer.sources = Some(&self.sources);

            self.declarations.to_css(&mut printer)?;

            drop(printer);
            Ok(ToCssResult { code: dest })
        }
    }

    impl StyleSheet<BundlerAtRule> {
        pub fn parse_bundler(
            arena: &'static Bump,
            code: &[u8],
            options: ParserOptions<'static>,
            import_records: &mut Vec<ImportRecord>,
            source_index: SrcIndex,
        ) -> Maybe<(Self, StylesheetExtra), Err<ParserError>> {
            // `import_records` is shared by both `BundlerAtRuleParser` and the
            // inner `Parser`: derive a single raw `NonNull` from the unique
            // borrow; both the at-rule parser and `Parser::new` store copies of
            // that raw pointer. Neither holds a long-lived `&mut`, so
            // interleaved writes from `on_import_rule` and
            // `add_import_record`/`state`/`reset` each create a fresh short-lived
            // `&mut` from the shared SharedRW provenance — sound under SB.
            let import_records_ptr = core::ptr::NonNull::from(import_records);
            let mut at_rule_parser = BundlerAtRuleParser {
                arena,
                import_records: import_records_ptr.as_ptr(),
                layer_names: Vec::new(),
                anon_layer_count: 0,
                enclosing_layer: LayerName::default(),
            };
            Self::parse_with(
                arena,
                code,
                options,
                &mut at_rule_parser,
                Some(import_records_ptr),
                source_index,
            )
        }
    }
} // mod stylesheet_impl

// ───────────────────────────── StyleAttribute ─────────────────────────────

pub struct StyleAttribute {
    // Note: `DeclarationBlock<'bump>` borrows the parser arena; lifetime
    // erased to `'static` until 'bump threads through the rule tree (matches
    // `StyleRule.declarations` in rules/style.rs).
    pub(crate) declarations: DeclarationBlock<'static>,
    pub(crate) sources: Vec<Box<[u8]>>,
}

impl StyleAttribute {
    pub fn minify(&mut self, _options: MinifyOptions) {
        // TODO: IMPLEMENT THIS!
    }
}

// ───────────────────────────── RuleBodyParser ─────────────────────────────
//
// `RuleBodyItemParser`/`DeclarationParser` traits are hoisted above; this is
// pure trait-generic over `P`.

pub(crate) struct RuleBodyParser<'i, 't, P: RuleBodyItemParser> {
    pub(crate) input: &'i mut Parser<'t>,
    pub(crate) parser: &'i mut P,
}

impl<'i, 't, P> RuleBodyParser<'i, 't, P>
where
    P: RuleBodyItemParser<
            Declaration = <P as QualifiedRuleParser>::QualifiedRule,
            AtRule = <P as QualifiedRuleParser>::QualifiedRule,
        >,
{
    pub(crate) fn new(input: &'i mut Parser<'t>, parser: &'i mut P) -> Self {
        Self { input, parser }
    }

    /// TODO: result is actually `Result<I, (ParseError, &str)>` but nowhere
    /// in the source do I actually see it using the string part of the tuple.
    pub(crate) fn next(&mut self) -> Option<CssResult<<P as QualifiedRuleParser>::QualifiedRule>> {
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
                                (&mut *self.parser, name),
                                |(parser, name), input| {
                                    input.expect_colon()?;
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
                self.input
                    .parse_until_after(Delimiters::SEMICOLON, move |_i| {
                        Err(start.source_location().new_unexpected_token_error(token))
                    })
            };

            return Some(result);
        }
    }
}

// ───────────────────────────── ParserOptions ─────────────────────────────

pub struct ParserOptions<'a> {
    /// Filename to use in error messages.
    pub filename: &'static [u8], // TODO: lifetime
    /// Whether to enable [CSS modules](https://github.com/css-modules/css-modules).
    pub css_modules: Option<css_modules::Config>,
    /// The source index to assign to all parsed rules. Impacts the source map
    /// when the style sheet is serialized.
    pub(crate) source_index: u32,
    /// Whether to ignore invalid rules and declarations rather than erroring.
    pub(crate) error_recovery: bool,
    /// A list that will be appended to when a warning occurs.
    ///
    /// Stored as a raw `NonNull<Log>` so `warn(&self)`
    /// can soundly write through it. Deriving `&mut Log` from a `&self`-reachable
    /// `&'a mut Log` (the previous representation) is UB under Stacked Borrows
    /// — see PORTING.md §Forbidden patterns. The caller that constructs
    /// `ParserOptions` guarantees the pointee outlives `'a` and is not aliased
    /// for the duration of parsing.
    pub logger: Option<core::ptr::NonNull<Log>>,
    /// Feature flags to enable.
    pub flags: ParserFlags,
    _lt: core::marker::PhantomData<&'a mut Log>,
}

impl<'a> ParserOptions<'a> {
    pub(crate) fn warn(&self, warning: &ParseError<ParserError>) {
        if let Some(lg) = self.logger {
            // SAFETY: `logger` was constructed from a unique `&'a mut Log` (see
            // `default`); the pointee outlives `'a` and no other borrow of the
            // Log exists for the duration of parsing.
            let lg: &mut Log = unsafe { &mut *lg.as_ptr() };
            lg.add_warning_fmt_line_col(
                self.filename,
                warning.location.line,
                warning.location.column,
                format_args!("{}", warning.kind),
            );
        }
    }

    pub(crate) fn warn_fmt(&self, args: fmt::Arguments<'_>, line: u32, column: u32) {
        if let Some(lg) = self.logger {
            // SAFETY: see `warn` — `logger` carries `*mut Log` provenance from a
            // unique `&'a mut Log`; no other borrow exists during this call.
            let lg: &mut Log = unsafe { &mut *lg.as_ptr() };
            lg.add_warning_fmt_line_col(self.filename, line, column, args);
        }
    }

    pub(crate) fn warn_fmt_with_notes(
        &self,
        args: fmt::Arguments<'_>,
        line: u32,
        column: u32,
        notes: Box<[bun_ast::Data]>,
    ) {
        if let Some(lg) = self.logger {
            // SAFETY: see `warn`.
            let lg: &mut Log = unsafe { &mut *lg.as_ptr() };
            lg.add_warning_fmt_line_col_with_notes(self.filename, line, column, args, notes);
        }
    }

    pub fn default(log: Option<&'a mut Log>) -> ParserOptions<'a> {
        ParserOptions {
            filename: b"",
            css_modules: None,
            source_index: 0,
            error_recovery: false,
            logger: log.map(core::ptr::NonNull::from),
            flags: ParserFlags::default(),
            _lt: core::marker::PhantomData,
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
impl ParserOpts {
    #[inline]
    pub(crate) fn css_modules(self) -> bool {
        self.contains(Self::CSS_MODULES)
    }
}

pub struct Parser<'a> {
    pub(crate) input: &'a mut ParserInput<'a>,
    pub(crate) at_start_of: Option<BlockType>,
    pub(crate) stop_before: Delimiters,
    pub(crate) flags: ParserOpts,
    /// Stored as a raw `NonNull` because `BundlerAtRuleParser` holds an aliasing
    /// raw pointer to the same list. Keeping a long-lived `&'a mut` here would
    /// be invalidated under Stacked Borrows the moment `on_import_rule`
    /// derives its own `&mut` from the sibling raw pointer. Each access site
    /// materialises a fresh short-lived `&mut` instead.
    pub(crate) import_records: Option<core::ptr::NonNull<Vec<ImportRecord>>>,
    pub(crate) extra: Option<&'a mut ParserExtra>,
}

impl<'a> Parser<'a> {
    pub(crate) fn add_symbol_for_name(
        &mut self,
        name: &[u8],
        tag: CssRefTag,
        loc: bun_ast::Loc,
    ) -> bun_ast::Ref {
        // don't call this if css modules is not enabled!
        debug_assert!(self.flags.css_modules());
        debug_assert!(self.extra.is_some());
        // tag should only have one bit set, or none
        debug_assert!(tag.bits().count_ones() <= 1);

        let extra = self.extra.as_deref_mut().unwrap();
        // Split borrows so the miss arm can grow `symbols` while
        // `local_scope` is borrowed by the entry.
        let symbols = &mut extra.symbols;
        let local_scope = &mut extra.local_scope;
        let source_index = extra.source_index.get();

        // SAFETY: `name` is a slice into the parser source / arena, both of
        // which outlive the symbol table (`ParserExtra` is consumed into
        // `StylesheetExtra` alongside the same arena). Detach the borrow so it
        // satisfies `Symbol.original_name: &'static [u8]` (the parser's
        // crate-wide lifetime erasure — see PORTING.md §Lifetimes).
        let name_static: &'static [u8] = unsafe { src_str(name) };

        // Borrowed probe so a repeated class/id name doesn't box a fresh key
        // per selector; `StringArrayHashMap::get_or_put` boxes on miss only.
        let gop = local_scope.get_or_put(name).expect("unreachable");
        let entry = gop.value_ptr;
        if gop.found_existing {
            let prev_tag = entry.ref_.tag();
            if !prev_tag.contains(CssRefTag::CLASS) && tag.contains(CssRefTag::CLASS) {
                entry.loc = loc;
                entry.ref_.set_tag(prev_tag | tag);
            }
        } else {
            let inner_index = u32::try_from(symbols.len()).unwrap();
            symbols.push(bun_ast::Symbol {
                kind: bun_ast::SymbolKind::LocalCss,
                original_name: name_static.into(),
                ..Default::default()
            });
            *entry = LocalEntry {
                ref_: CssRef::new(inner_index, tag),
                loc,
            };
        }

        entry.ref_.to_real_ref(source_index)
    }

    // TODO: dedupe import records??
    pub(crate) fn add_import_record(
        &mut self,
        url: &[u8],
        start_position: usize,
        kind: ImportKind,
    ) -> CssResult<u32> {
        if let Some(ptr) = self.import_records {
            // SAFETY: see `Parser.import_records` field doc — sole live `&mut`
            // for this scope; provenance shared only with raw-pointer aliases.
            let import_records = unsafe { &mut *ptr.as_ptr() };
            let idx = u32::try_from(import_records.len()).unwrap();
            // SAFETY: `url` borrows the parser source / arena which outlives
            // every `ImportRecord` produced by this parse; the lifetime
            // is erased to 'static (see PORTING.md §Lifetimes).
            let url_static: &'static [u8] = unsafe { src_str(url) };
            import_records.push(ImportRecord {
                path: ast::fs::path_init(url_static),
                kind,
                range: bun_ast::Range {
                    loc: bun_ast::Loc {
                        start: i32::try_from(start_position).expect("int cast"),
                    },
                    // TODO: technically this is not correct because the url could be escaped
                    len: i32::try_from(url.len()).expect("int cast"),
                },
                tag: Default::default(),
                loader: None,
                source_index: Default::default(),
                original_path: b"",
                flags: Default::default(),
            });
            Ok(idx)
        } else {
            // SAFETY: same lifetime erasure as above; the error token is only
            // used for diagnostics borrowing the same source.
            let url_static: &'static [u8] = unsafe { src_str(url) };
            Err(self.new_basic_unexpected_token_error(Token::UnquotedUrl(url_static)))
        }
    }

    #[inline]
    pub(crate) fn arena(&self) -> &Bump {
        self.input.tokenizer.arena
    }

    /// Create a new Parser.
    ///
    /// Pass in `import_records` to track imports (`@import` rules, `url()`
    /// tokens). If this is `None`, calling `Parser::add_import_record` will
    /// error.
    pub fn new(
        input: &'a mut ParserInput<'a>,
        import_records: Option<core::ptr::NonNull<Vec<ImportRecord>>>,
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

    pub(crate) fn new_custom_error(&self, err: ParserError) -> ParseError<ParserError> {
        self.current_source_location().new_custom_error(err)
    }

    pub(crate) fn new_basic_error(&self, kind: BasicParseErrorKind) -> BasicParseError {
        BasicParseError {
            kind,
            location: self.current_source_location(),
        }
    }

    pub(crate) fn new_error(&self, kind: BasicParseErrorKind) -> ParseError<ParserError> {
        ParseError {
            kind: errors_::ParserErrorKind::basic(kind),
            location: self.current_source_location(),
        }
    }

    pub(crate) fn new_unexpected_token_error(&self, token: Token) -> ParseError<ParserError> {
        self.new_error(BasicParseErrorKind::unexpected_token(token))
    }

    pub(crate) fn new_basic_unexpected_token_error(&self, token: Token) -> ParseError<ParserError> {
        self.new_basic_error(BasicParseErrorKind::unexpected_token(token))
            .into_default_parse_error()
    }

    pub(crate) fn current_source_location(&self) -> SourceLocation {
        self.input.tokenizer.current_source_location()
    }

    pub(crate) fn current_source_map_url(&self) -> Option<&[u8]> {
        self.input.tokenizer.current_source_map_url()
    }

    /// Return a slice of the CSS input, from the given position to the current one.
    pub(crate) fn slice_from(&self, start_position: usize) -> &[u8] {
        self.input.tokenizer.slice_from(start_position)
    }

    /// Implementation of `Vec<T>::parse`
    pub(crate) fn parse_list<T>(
        &mut self,
        parse_one: impl Fn(&mut Parser) -> CssResult<T>,
    ) -> CssResult<Vec<T>> {
        self.parse_comma_separated(parse_one)
    }

    /// Parse a list of comma-separated values, all with the same syntax.
    pub(crate) fn parse_comma_separated<T>(
        &mut self,
        parse_one: impl Fn(&mut Parser) -> CssResult<T>,
    ) -> CssResult<Vec<T>> {
        self.parse_comma_separated_internal(|(), p| parse_one(p), false)
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
    pub(crate) fn try_parse<R>(
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

    #[inline]
    pub(crate) fn parse_nested_block<T>(
        &mut self,
        parsefn: impl FnOnce(&mut Parser) -> CssResult<T>,
    ) -> CssResult<T> {
        parse_nested_block(self, parsefn)
    }

    #[inline]
    pub(crate) fn math_fn_parse_failures(&self) -> u64 {
        self.input.math_fn_parse_failures
    }

    #[inline]
    pub(crate) fn note_math_fn_parse_failure(&mut self) {
        self.input.math_fn_parse_failures += 1;
    }

    /// See `ParserInput::token_list_parse_failures`.
    #[inline]
    pub(crate) fn token_list_parse_failures(&self) -> u64 {
        self.input.token_list_parse_failures
    }

    #[inline]
    pub(crate) fn note_token_list_parse_failure(&mut self) {
        self.input.token_list_parse_failures += 1;
    }

    pub(crate) fn is_exhausted(&mut self) -> bool {
        self.expect_exhausted().is_ok()
    }

    /// Parse the input until exhaustion and check that it contains no "error"
    /// token. See `Token::is_parse_error`.
    pub(crate) fn expect_no_error_token(&mut self) -> CssResult<()> {
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

    pub(crate) fn expect_percentage(&mut self) -> CssResult<f32> {
        let start_location = self.current_source_location();
        let tok = self.next()?;
        if let Token::Percentage { unit_value, .. } = tok {
            return Ok(*unit_value);
        }
        let tok = tok.clone();
        Err(start_location.new_unexpected_token_error(tok))
    }

    pub(crate) fn expect_comma(&mut self) -> CssResult<()> {
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
    pub(crate) fn expect_integer(&mut self) -> CssResult<i32> {
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
    pub(crate) fn expect_number(&mut self) -> CssResult<f32> {
        let start_location = self.current_source_location();
        let tok = self.next()?;
        if let Token::Number(n) = tok {
            return Ok(n.value);
        }
        let tok = tok.clone();
        Err(start_location.new_unexpected_token_error(tok))
    }

    pub(crate) fn expect_delim(&mut self, delim: u8) -> CssResult<()> {
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

    pub(crate) fn expect_parenthesis_block(&mut self) -> CssResult<()> {
        let start_location = self.current_source_location();
        let tok = self.next()?;
        if matches!(tok, Token::OpenParen) {
            return Ok(());
        }
        let tok = tok.clone();
        Err(start_location.new_unexpected_token_error(tok))
    }

    pub(crate) fn expect_colon(&mut self) -> CssResult<()> {
        let start_location = self.current_source_location();
        let tok = self.next()?;
        if matches!(tok, Token::Colon) {
            return Ok(());
        }
        let tok = tok.clone();
        Err(start_location.new_unexpected_token_error(tok))
    }

    pub(crate) fn expect_string(&mut self) -> CssResult<&[u8]> {
        let start_location = self.current_source_location();
        let tok = self.next()?;
        if let Token::QuotedString(s) = tok {
            return Ok(*s);
        }
        let tok = tok.clone();
        Err(start_location.new_unexpected_token_error(tok))
    }

    pub(crate) fn expect_ident(&mut self) -> CssResult<&[u8]> {
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
    pub(crate) fn expect_ident_or_string(&mut self) -> CssResult<&[u8]> {
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

    pub(crate) fn expect_ident_matching(&mut self, name: &[u8]) -> CssResult<()> {
        let start_location = self.current_source_location();
        let tok = self.next()?;
        if let Token::Ident(i) = tok {
            if strings::eql_case_insensitive_asciii_check_length(name, i) {
                return Ok(());
            }
        }
        let tok = tok.clone();
        Err(start_location.new_unexpected_token_error(tok))
    }

    pub(crate) fn expect_function(&mut self) -> CssResult<&[u8]> {
        let start_location = self.current_source_location();
        let tok = self.next()?;
        if let Token::Function(fn_name) = tok {
            return Ok(*fn_name);
        }
        let tok = tok.clone();
        Err(start_location.new_unexpected_token_error(tok))
    }

    pub(crate) fn expect_function_matching(&mut self, name: &[u8]) -> CssResult<()> {
        let start_location = self.current_source_location();
        let tok = self.next()?;
        if let Token::Function(fn_name) = tok {
            if strings::eql_case_insensitive_asciii_check_length(name, fn_name) {
                return Ok(());
            }
        }
        let tok = tok.clone();
        Err(start_location.new_unexpected_token_error(tok))
    }

    pub(crate) fn expect_curly_bracket_block(&mut self) -> CssResult<()> {
        let start_location = self.current_source_location();
        let tok = self.next()?;
        if matches!(tok, Token::OpenCurly) {
            return Ok(());
        }
        let tok = tok.clone();
        Err(start_location.new_unexpected_token_error(tok))
    }

    /// Parse a `<url-token>` and return the unescaped value.
    pub(crate) fn expect_url(&mut self) -> CssResult<&[u8]> {
        let start_location = self.current_source_location();
        let tok = self.next()?;
        match tok {
            Token::UnquotedUrl(value) => return Ok(*value),
            Token::Function(name) => {
                if strings::eql_case_insensitive_asciii_check_length(b"url", name) {
                    return self.parse_nested_block(|parser| parser.expect_string_cloned());
                }
            }
            _ => {}
        }
        let tok = tok.clone();
        Err(start_location.new_unexpected_token_error(tok))
    }

    /// Parse either a `<url-token>` or a `<string-token>`, and return the
    /// unescaped value.
    pub(crate) fn expect_url_or_string(&mut self) -> CssResult<&[u8]> {
        let start_location = self.current_source_location();
        let tok = self.next()?;
        match tok {
            Token::UnquotedUrl(value) => return Ok(*value),
            Token::QuotedString(value) => return Ok(*value),
            Token::Function(name) => {
                if strings::eql_case_insensitive_asciii_check_length(b"url", name) {
                    return self.parse_nested_block(|parser| parser.expect_string_cloned());
                }
            }
            _ => {}
        }
        let tok = tok.clone();
        Err(start_location.new_unexpected_token_error(tok))
    }

    // ──────────────────────────────────────────────────────────────────────
    // `*_cloned` helpers — C-7 in PORT_NOTES_PLAN.
    //
    // These wrap `expect_*` / `slice_from` and return the slice with its
    // lifetime detached from `&mut self` (to `'static`, matching `Token`'s
    // current `&'static [u8]` payload). All `unsafe { src_str(..) }` call
    // sites in the CSS parser route through here instead of laundering the
    // lifetime locally.
    //
    // Once C-9 threads `'i` through `Token<'i>`, these become safe
    // `-> CssResult<&'i [u8]>` and the body drops the `unsafe` — no caller
    // changes needed.
    // ──────────────────────────────────────────────────────────────────────

    /// `expect_ident` with the borrow detached from `&mut self` so the parser
    /// is reusable while the slice is held (and the slice fits `Token::Ident`).
    #[inline]
    pub(crate) fn expect_ident_cloned(&mut self) -> CssResult<&'static [u8]> {
        let s = self.expect_ident()?;
        // SAFETY: `s` is a sub-slice of `self.input.tokenizer.src` (`&'a [u8]`)
        // or arena-owned; the returned reference is only ever stored in
        // structures reachable through the same `Parser<'a>`. See `src_str`.
        Ok(unsafe { src_str(s) })
    }

    /// `expect_function` with the borrow detached. See [`expect_ident_cloned`].
    #[inline]
    pub(crate) fn expect_function_cloned(&mut self) -> CssResult<&'static [u8]> {
        let s = self.expect_function()?;
        // SAFETY: see `expect_ident_cloned`.
        Ok(unsafe { src_str(s) })
    }

    /// `expect_string` with the borrow detached. See [`expect_ident_cloned`].
    #[inline]
    pub(crate) fn expect_string_cloned(&mut self) -> CssResult<&'static [u8]> {
        let s = self.expect_string()?;
        // SAFETY: see `expect_ident_cloned`.
        Ok(unsafe { src_str(s) })
    }

    /// `expect_ident_or_string` with the borrow detached. See [`expect_ident_cloned`].
    #[inline]
    pub(crate) fn expect_ident_or_string_cloned(&mut self) -> CssResult<&'static [u8]> {
        let s = self.expect_ident_or_string()?;
        // SAFETY: see `expect_ident_cloned`.
        Ok(unsafe { src_str(s) })
    }

    /// `expect_url` with the borrow detached. See [`expect_ident_cloned`].
    #[inline]
    pub(crate) fn expect_url_cloned(&mut self) -> CssResult<&'static [u8]> {
        let s = self.expect_url()?;
        // SAFETY: see `expect_ident_cloned`.
        Ok(unsafe { src_str(s) })
    }

    /// `slice_from` with the borrow detached. See [`expect_ident_cloned`].
    #[inline]
    pub(crate) fn slice_from_cloned(&self, start_position: usize) -> &'static [u8] {
        // SAFETY: see `expect_ident_cloned`.
        unsafe { src_str(self.slice_from(start_position)) }
    }

    pub(crate) fn position(&self) -> usize {
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
    pub(crate) fn parse_until_after<T>(
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

    pub(crate) fn parse_until_before<T>(
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

    pub(crate) fn parse_entirely<T, C>(
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
    pub(crate) fn expect_exhausted(&mut self) -> CssResult<()> {
        let start = self.state();
        let result: CssResult<()> = match self.next() {
            Ok(t) => {
                let t = t.clone();
                Err(start.source_location().new_unexpected_token_error(t))
            }
            Err(e) => {
                if matches!(
                    e.kind,
                    errors_::ParserErrorKind::basic(BasicParseErrorKind::end_of_input)
                ) {
                    Ok(())
                } else {
                    unreachable!("Unexpected error encountered: {}", e.kind);
                }
            }
        };
        self.reset(&start);
        result
    }

    pub(crate) fn skip_cdc_and_cdo(&mut self) {
        if let Some(block_type) = self.at_start_of.take() {
            consume_until_end_of_block(block_type, &mut self.input.tokenizer);
        }
        self.input.tokenizer.skip_cdc_and_cdo();
    }

    pub(crate) fn skip_whitespace(&mut self) {
        if let Some(block_type) = self.at_start_of.take() {
            consume_until_end_of_block(block_type, &mut self.input.tokenizer);
        }
        self.input.tokenizer.skip_whitespace();
    }

    pub(crate) fn next(&mut self) -> CssResult<&Token> {
        self.skip_whitespace();
        self.next_including_whitespace_and_comments()
    }

    /// Same as `Parser::next`, but does not skip whitespace tokens.
    pub(crate) fn next_including_whitespace(&mut self) -> CssResult<&Token> {
        loop {
            let tok = self.next_including_whitespace_and_comments()?;
            if !matches!(tok, Token::Comment(_)) {
                break;
            }
        }
        Ok(&self.input.cached_token.as_ref().unwrap().token)
    }

    pub(crate) fn next_byte(&self) -> Option<u8> {
        let byte = self.input.tokenizer.next_byte();
        if self.stop_before.intersects(Delimiters::from_byte(byte)) {
            return None;
        }
        byte
    }

    pub(crate) fn reset(&mut self, state_: &ParserState) {
        self.input.tokenizer.reset(state_);
        self.at_start_of = state_.at_start_of;
        if let Some(ptr) = self.import_records {
            // Roll back any speculatively-added @import/url() records.
            // SAFETY: see `Parser.import_records` field doc.
            unsafe { &mut *ptr.as_ptr() }
                .shrink_retaining_capacity(state_.import_record_count as usize);
        }
    }

    pub(crate) fn state(&self) -> ParserState {
        ParserState {
            position: self.input.tokenizer.get_position(),
            current_line_start_position: self.input.tokenizer.current_line_start_position,
            current_line_number: self.input.tokenizer.current_line_number,
            at_start_of: self.at_start_of,
            // SAFETY: see `Parser.import_records` field doc.
            import_record_count: self
                .import_records
                .map(|ptr| u32::try_from(unsafe { (*ptr.as_ptr()).len() }).unwrap())
                .unwrap_or(0),
        }
    }

    /// Same as `Parser::next`, but does not skip whitespace or comment tokens.
    pub(crate) fn next_including_whitespace_and_comments(&mut self) -> CssResult<&Token> {
        if let Some(block_type) = self.at_start_of.take() {
            consume_until_end_of_block(block_type, &mut self.input.tokenizer);
        }

        let byte = self.input.tokenizer.next_byte();
        if self.stop_before.intersects(Delimiters::from_byte(byte)) {
            return Err(self.new_error(BasicParseErrorKind::end_of_input));
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
                Err(()) => return Err(self.new_error(BasicParseErrorKind::end_of_input)),
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
    pub(crate) fn new_error_for_next_token(&mut self) -> ParseError<ParserError> {
        let token = match self.next() {
            Ok(t) => t.clone(),
            Err(e) => return e,
        };
        self.new_error(BasicParseErrorKind::unexpected_token(token))
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
    pub(crate) const NONE: Delimiters = Delimiters::empty();

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

    pub(crate) fn from_byte(byte: Option<u8>) -> Delimiters {
        match byte {
            Some(b) => Self::TABLE[b as usize],
            None => Delimiters::empty(),
        }
    }
}

pub struct ParserInput<'a> {
    pub(crate) tokenizer: Tokenizer<'a>,
    pub(crate) cached_token: Option<CachedToken>,
    pub(crate) nesting_depth: u32,
    /// Set once a nested block fails to parse and the end of input is reached
    /// without ever finding its closing token, i.e. the stylesheet is
    /// truncated somewhere inside that block. Everything from
    /// `start_position` to the end of input is inside the unclosed block, so
    /// re-parsing any block in that range can only fail the same way again.
    /// `parse_nested_block` uses this to fail such attempts immediately
    /// instead of re-scanning (and re-recursing through) the truncated
    /// suffix once per backtracking alternative per nesting level.
    unclosed_block_at_eof: Option<UnclosedBlockAtEof>,
    math_fn_parse_failures: u64,
    /// Monotonic count of raw token-list parse failures
    /// (`TokenList::parse_into`). A token-list parse is context-free: it
    /// fails or succeeds the same way every time it runs over the same
    /// tokens at the same block-nesting depth. Backtracking callers sample
    /// this before an alternative that buffers token lists internally; if it
    /// grew, re-parsing the same range through another token-list-based
    /// alternative is guaranteed to fail again, so they propagate the error
    /// instead of retrying (which is exponential in the nesting depth).
    token_list_parse_failures: u64,
}

/// See `ParserInput::unclosed_block_at_eof`.
#[derive(Copy, Clone)]
struct UnclosedBlockAtEof {
    /// Position of the first token inside the earliest known unclosed block.
    start_position: usize,
    /// Tokenizer state at the end of input, captured when the unclosed block
    /// was discovered.
    eof_state: ParserState,
}

impl<'a> ParserInput<'a> {
    /// Create a `ParserInput` borrowing `code` and an arena for unescaped
    /// strings. The caller owns the arena and it must
    /// outlive every `Token` produced from this input.
    ///
    /// PORTING.md §Forbidden: do not fabricate `&'a Bump` from a boxed field
    /// via raw-pointer cast; the previous self-referential `owned_arena` hack
    /// was removed. Callers now pass `&'a Bump` explicitly.
    pub fn new(code: &'a [u8], arena: &'a Bump) -> ParserInput<'a> {
        ParserInput {
            tokenizer: Tokenizer::init_with_arena(code, arena),
            cached_token: None,
            nesting_depth: 0,
            unclosed_block_at_eof: None,
            math_fn_parse_failures: 0,
            token_list_parse_failures: 0,
        }
    }
}

/// A capture of the internal state of a `Parser` (including the position
/// within the input), obtained from the `Parser::position` method.
#[derive(Copy, Clone)]
pub struct ParserState {
    pub(crate) position: usize,
    pub(crate) current_line_start_position: usize,
    pub(crate) current_line_number: u32,
    pub(crate) import_record_count: u32,
    pub(crate) at_start_of: Option<BlockType>,
}

impl ParserState {
    pub(crate) fn source_location(&self) -> SourceLocation {
        SourceLocation {
            line: self.current_line_number,
            // `current_line_start_position` is maintained with wrapping arithmetic
            // (see `consume_4byte_intro`), so the inverse must wrap as well.
            column: u32::try_from(self.position.wrapping_sub(self.current_line_start_position) + 1)
                .expect("int cast"),
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

pub(crate) mod nth {
    use super::*;

    pub(crate) type NthResult = (i32, i32);

    /// Parse the *An+B* notation, as found in the `:nth-child()` selector.
    pub(crate) fn parse_nth(input: &mut Parser) -> CssResult<NthResult> {
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
                    if strings::eql_case_insensitive_asciii_check_length(unit, b"n") {
                        return parse_b(input, a);
                    } else if strings::eql_case_insensitive_asciii_check_length(unit, b"n-") {
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
                    if strings::eql_case_insensitive_asciii_check_length(value, b"n") {
                        return parse_b(input, 1);
                    } else if strings::eql_case_insensitive_asciii_check_length(value, b"-n") {
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
            if *d == u32::from(b'+') {
                return parse_signless_b(input, a, 1);
            }
            if *d == u32::from(b'-') {
                return parse_signless_b(input, a, -1);
            }
        }
        if let Token::Number(n) = tok {
            if let (true, Some(int_value)) = (n.has_sign, n.int_value) {
                return Ok((a, int_value));
            }
        }
        input.reset(&start);
        Ok((a, 0))
    }

    fn parse_signless_b(input: &mut Parser, a: i32, b_sign: i32) -> CssResult<NthResult> {
        let tok = input.next()?;
        if let Token::Number(n) = tok {
            if let (false, Some(b)) = (n.has_sign, n.int_value) {
                return Ok((a, b_sign * b));
            }
        }
        let tok = tok.clone();
        Err(input.new_unexpected_token_error(tok))
    }

    fn parse_n_dash_digits(str: &[u8]) -> Maybe<i32, ()> {
        let bytes = str;
        if bytes.len() >= 3
            && strings::eql_case_insensitive_asciii_check_length(&bytes[0..2], b"n-")
            && bytes[2..].iter().all(|&b| b >= b'0' && b <= b'9')
        {
            parse_number_saturate(&str[1..]) // Include the minus sign
        } else {
            Err(())
        }
    }

    fn parse_number_saturate(string: &[u8]) -> Maybe<i32, ()> {
        let arena = Bump::new();
        let mut input = ParserInput::new(string, &arena);
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
    pub(crate) token: Token,
    pub(crate) start_position: usize,
    pub(crate) end_state: ParserState,
}

// ───────────────────────────── Tokenizer ─────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq)]
enum SeenStatus {
    DontCare,
    LookingForThem,
    SeenAtLeastOne,
}

pub struct Tokenizer<'a> {
    pub(crate) src: &'a [u8],
    pub(crate) position: usize,
    pub(crate) source_map_url: Option<&'a [u8]>,
    pub(crate) current_line_start_position: usize,
    pub(crate) current_line_number: u32,
    pub(crate) arena: &'a Bump,
    var_or_env_functions: SeenStatus,
    pub(crate) previous: Token,
}

const FORM_FEED_BYTE: u8 = 0x0C;
const REPLACEMENT_CHAR: u32 = 0xFFFD;
const REPLACEMENT_CHAR_UNICODE: [u8; 3] = [0xEF, 0xBF, 0xBD];
/// UTF-8 encoding of U+FFFD REPLACEMENT CHARACTER, written by `serializer`
/// when escaping a NUL byte (css-syntax requires U+0000 → U+FFFD; upstream
/// rust-cssparser writes `"\u{FFFD}"`).
const REPLACEMENT_CHAR_UTF8: &[u8] = &REPLACEMENT_CHAR_UNICODE;
const MAX_ONE_B: u32 = 0x80;
const MAX_TWO_B: u32 = 0x800;
const MAX_THREE_B: u32 = 0x10000;

/// Erase a source-slice borrow to `'static` for storing in `Token` payloads.
///
/// PORTING.md §Forbidden flags this erasure. The proper fix is to thread a
/// real `'a` lifetime through `Token<'a>` / `Dimension<'a>` / `CachedToken<'a>`
/// so `slice_from`/`to_slice` return `&'a [u8]`. That change is blocked
/// on `crate::Token` (defined in `lib.rs`, not this file) gaining `<'a>` —
/// once `lib.rs` is updated, delete this fn and every call site compiles with
/// the honest lifetime.
// TODO: delete once `Token<'a>` lands in lib.rs; see verifier bug
// "src_str / Tokenizer::slice_from / CopyOnWriteStr::to_slice".
// SAFETY: every call site below feeds either (a) a sub-slice of `self.src`
// (`&'a [u8]`) or (b) an arena-allocated `CopyOnWriteStr::to_slice()` whose
// backing storage lives in `self.arena: &'a Bump`. The returned reference
// is only ever stored in a `Token` reachable through that same `Parser<'a>`.
#[inline(always)]
pub(crate) unsafe fn src_str(s: &[u8]) -> &'static [u8] {
    // SAFETY: caller upholds the invariant documented on this function above.
    unsafe { bun_collections::detach_lifetime(s) }
}

impl<'a> Tokenizer<'a> {
    pub(crate) fn init_with_arena(src: &'a [u8], arena: &'a Bump) -> Tokenizer<'a> {
        Tokenizer {
            src,
            position: 0,
            source_map_url: None,
            current_line_start_position: 0,
            current_line_number: 0,
            arena,
            var_or_env_functions: SeenStatus::DontCare,
            previous: Token::Whitespace(b""),
        }
    }

    pub(crate) fn current_source_map_url(&self) -> Option<&[u8]> {
        self.source_map_url
    }

    pub(crate) fn get_position(&self) -> usize {
        debug_assert!(strings::is_on_char_boundary(self.src, self.position));
        self.position
    }

    pub(crate) fn state(&self) -> ParserState {
        ParserState {
            position: self.position,
            current_line_start_position: self.current_line_start_position,
            current_line_number: self.current_line_number,
            at_start_of: None,
            import_record_count: 0,
        }
    }

    pub(crate) fn skip_whitespace(&mut self) {
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

    pub(crate) fn current_source_location(&self) -> SourceLocation {
        SourceLocation {
            line: self.current_line_number,
            // `current_line_start_position` is maintained with wrapping arithmetic
            // (see `consume_4byte_intro`), so the inverse must wrap as well.
            column: u32::try_from(self.position.wrapping_sub(self.current_line_start_position) + 1)
                .expect("int cast"),
        }
    }

    pub fn prev(&self) -> Token {
        debug_assert!(self.position > 0);
        self.previous.clone()
    }

    #[inline]
    pub(crate) fn is_eof(&self) -> bool {
        self.position >= self.src.len()
    }

    pub(crate) fn see_function(&mut self, name: &[u8]) {
        if self.var_or_env_functions == SeenStatus::LookingForThem {
            // Note: this `&&` is always false; kept as-is intentionally.
            if strings::eql_case_insensitive_ascii_check_length(name, b"var")
                && strings::eql_case_insensitive_ascii_check_length(name, b"env")
            {
                self.var_or_env_functions = SeenStatus::SeenAtLeastOne;
            }
        }
    }

    /// Return error if it is eof.
    #[inline]
    pub(crate) fn next(&mut self) -> Maybe<Token, ()> {
        self.next_impl()
    }

    pub(crate) fn next_impl(&mut self) -> Maybe<Token, ()> {
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
                } else if !self.is_eof() && matches!(self.next_byte_unchecked(), b'0'..=b'9' | b'-')
                {
                    Token::UnrestrictedHash(self.consume_name())
                } else {
                    Token::Delim(u32::from(b'#'))
                }
            }
            b'$' => {
                if self.starts_with(b"$=") {
                    self.advance(2);
                    Token::SuffixMatch
                } else {
                    self.advance(1);
                    Token::Delim(u32::from(b'$'))
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
                    Token::Delim(u32::from(b'*'))
                }
            }
            b'+' => {
                if (self.has_at_least(1) && self.byte_at(1).is_ascii_digit())
                    || (self.has_at_least(2)
                        && self.byte_at(1) == b'.'
                        && self.byte_at(2).is_ascii_digit())
                {
                    self.consume_numeric()
                } else {
                    self.advance(1);
                    Token::Delim(u32::from(b'+'))
                }
            }
            b',' => {
                self.advance(1);
                Token::Comma
            }
            b'-' => {
                if (self.has_at_least(1) && self.byte_at(1).is_ascii_digit())
                    || (self.has_at_least(2)
                        && self.byte_at(1) == b'.'
                        && self.byte_at(2).is_ascii_digit())
                {
                    self.consume_numeric()
                } else if self.starts_with(b"-->") {
                    self.advance(3);
                    Token::Cdc
                } else if self.is_ident_start() {
                    self.consume_ident_like()
                } else {
                    self.advance(1);
                    Token::Delim(u32::from(b'-'))
                }
            }
            b'.' => {
                if self.has_at_least(1) && self.byte_at(1).is_ascii_digit() {
                    self.consume_numeric()
                } else {
                    self.advance(1);
                    Token::Delim(u32::from(b'.'))
                }
            }
            b'/' => {
                if self.starts_with(b"/*") {
                    Token::Comment(self.consume_comment())
                } else {
                    self.advance(1);
                    Token::Delim(u32::from(b'/'))
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
                    Token::Delim(u32::from(b'<'))
                }
            }
            b'@' => {
                self.advance(1);
                if self.is_ident_start() {
                    Token::AtKeyword(self.consume_name())
                } else {
                    Token::Delim(u32::from(b'@'))
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
                    Token::Delim(u32::from(b'\\'))
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
                    Token::Delim(u32::from(b'^'))
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
                    Token::Delim(u32::from(b'|'))
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
                    Token::Delim(u32::from(b'~'))
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

    pub(crate) fn reset(&mut self, state2: &ParserState) {
        self.position = state2.position;
        self.current_line_start_position = state2.current_line_start_position;
        self.current_line_number = state2.current_line_number;
    }

    pub(crate) fn skip_cdc_and_cdo(&mut self) {
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

    pub(crate) fn consume_numeric(&mut self) -> Token {
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
            && self.byte_at(1).is_ascii_digit()
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
            if self.byte_at(1).is_ascii_digit()
                || (self.has_at_least(2)
                    && matches!(self.byte_at(1), b'+' | b'-')
                    && self.byte_at(2).is_ascii_digit())
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
            // Saturating cast.
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
                num: Num {
                    value: value as f32,
                    int_value,
                    has_sign,
                },
                unit,
            });
        }

        Token::Number(Num {
            value: value as f32,
            int_value,
            has_sign,
        })
    }

    pub(crate) fn consume_whitespace<const NEWLINE: bool>(&mut self) -> Token {
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

    pub(crate) fn consume_string<const SINGLE_QUOTE: bool>(&mut self) -> Token {
        let (str, bad) = self.consume_quoted_string::<SINGLE_QUOTE>();
        if bad {
            Token::BadString(str)
        } else {
            Token::QuotedString(str)
        }
    }

    pub(crate) fn consume_ident_like(&mut self) -> Token {
        let value = self.consume_name();
        if !self.is_eof() && self.next_byte_unchecked() == b'(' {
            self.advance(1);
            if strings::eql_case_insensitive_ascii_check_length(value, b"url") {
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

    pub(crate) fn consume_name(&mut self) -> &'static [u8] {
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
                    value_bytes.append(self.arena, &[b]);
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
                    value_bytes.append(self.arena, &REPLACEMENT_CHAR_UNICODE);
                }
                0x80..=0xBF => {
                    self.consume_continuation_byte();
                    value_bytes.append(self.arena, &[b]);
                }
                0xC0..=0xEF => {
                    self.advance(1);
                    value_bytes.append(self.arena, &[b]);
                }
                0xF0..=0xFF => {
                    self.consume_4byte_intro();
                    value_bytes.append(self.arena, &[b]);
                }
                _ => {
                    // ASCII
                    break;
                }
            }
        }

        value_bytes.to_slice()
    }

    pub(crate) fn consume_quoted_string<const SINGLE_QUOTE: bool>(
        &mut self,
    ) -> (&'static [u8], bool) {
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
                    string_bytes.append(self.arena, &REPLACEMENT_CHAR_UNICODE);
                    continue;
                }
                0x80..=0xBF => self.consume_continuation_byte(),
                0xF0..=0xFF => self.consume_4byte_intro(),
                _ => {
                    self.advance(1);
                }
            }

            string_bytes.append(self.arena, &[b]);
        }

        (string_bytes.to_slice(), false)
    }

    pub(crate) fn consume_unquoted_url(&mut self) -> Option<Token> {
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

    pub(crate) fn consume_unquoted_url_internal(&mut self) -> Token {
        let start_pos = self.position;
        let mut string_bytes: CopyOnWriteStr;

        loop {
            if self.is_eof() {
                return Token::UnquotedUrl(self.slice_from(start_pos));
            }
            // todo_stuff.match_byte
            match self.next_byte_unchecked() {
                b' ' | b'\t' | b'\n' | b'\r' | FORM_FEED_BYTE => {
                    let value = CopyOnWriteStr::Borrowed(self.slice_from(start_pos));
                    return self.consume_url_end(start_pos, value);
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
                    return self.consume_url_end(start_pos, string_bytes);
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
                    string_bytes.append(self.arena, &REPLACEMENT_CHAR_UNICODE);
                }
                0x80..=0xBF => {
                    self.consume_continuation_byte();
                    string_bytes.append(self.arena, &[b]);
                }
                0xF0..=0xFF => {
                    self.consume_4byte_intro();
                    string_bytes.append(self.arena, &[b]);
                }
                _ => {
                    self.advance(1);
                    string_bytes.append(self.arena, &[b]);
                }
            }
        }

        Token::UnquotedUrl(string_bytes.to_slice())
    }

    pub(crate) fn consume_url_end(
        &mut self,
        start_pos: usize,
        string: CopyOnWriteStr<'a>,
    ) -> Token {
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

    pub(crate) fn consume_bad_url(&mut self, start_pos: usize) -> Token {
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

    pub(crate) fn consume_escape_and_write(&mut self, bytes: &mut CopyOnWriteStr<'a>) {
        let val = self.consume_escape();
        let mut utf8bytes = [0u8; 4];
        let c = char::from_u32(val).unwrap_or('\u{FFFD}');
        let len = c.encode_utf8(&mut utf8bytes).len();
        bytes.append(self.arena, &utf8bytes[..len]);
    }

    pub(crate) fn consume_escape(&mut self) -> u32 {
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
                // valid Unicode scalar: not a surrogate, ≤ U+10FFFF
                if c != 0 && c <= 0x10FFFF && !(0xD800..=0xDFFF).contains(&c) {
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

    pub(crate) fn consume_hex_digits(&mut self) -> (u32, u32) {
        let (value, n) = bun_core::fmt::parse_hex_prefix(&self.src[self.position..], 6);
        self.advance(n);
        (value, n as u32)
    }

    pub(crate) fn consume_char(&mut self) -> u32 {
        let c = self.next_char();
        let len_utf8 = len_utf8(c).min(self.src.len() - self.position);
        self.position += len_utf8;
        // Note that due to the special case for the 4-byte sequence intro,
        // we must use wrapping add here.
        self.current_line_start_position = self
            .current_line_start_position
            .wrapping_add(len_utf8 - len_utf16(c));
        c
    }

    pub(crate) fn consume_comment(&mut self) -> &'static [u8] {
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
                        // SAFETY: see `src_str` — sub-slice of `self.src`.
                        let contents = unsafe { src_str(&self.src[start_position..end_position]) };
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

    pub(crate) fn check_for_source_map(&mut self, contents: &'a [u8]) {
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

    pub(crate) fn consume_newline(&mut self) {
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
    pub(crate) fn consume_continuation_byte(&mut self) {
        debug_assert!(self.next_byte_unchecked() & 0xC0 == 0x80);
        // Continuation bytes contribute to column overcount.
        self.current_line_start_position = self.current_line_start_position.wrapping_add(1);
        self.position += 1;
    }

    /// Advance over a single byte; the byte must be a UTF-8 sequence leader
    /// for a 4-byte sequence (0xF0..=0xF7).
    pub(crate) fn consume_4byte_intro(&mut self) {
        debug_assert!(self.next_byte_unchecked() & 0xF0 == 0xF0);
        self.position += 1;
        // 4 UTF-8 bytes encode 2 UTF-16 units (undercount). Input here is
        // unvalidated bytes, so only apply the -1 when a continuation byte
        // follows; a stray 0xF0..0xFF must not underflow the column math.
        if self.next_byte().is_some_and(|b| b & 0xC0 == 0x80) {
            self.current_line_start_position = self.current_line_start_position.wrapping_sub(1);
        }
    }

    pub(crate) fn is_ident_start(&self) -> bool {
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

    pub(crate) fn starts_with(&self, needle: &[u8]) -> bool {
        self.src[self.position..].starts_with(needle)
    }

    /// Advance over N bytes in the input.
    pub(crate) fn advance(&mut self, n: usize) {
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
    pub(crate) fn consume_known_byte(&mut self, byte: u8) {
        debug_assert!(byte != b'\r' && byte != b'\n' && byte != FORM_FEED_BYTE);
        self.position += 1;
        if byte & 0xF0 == 0xF0 {
            // See `consume_4byte_intro`: input is unvalidated bytes, so only
            // apply the UTF-16 undercount when a continuation byte follows.
            if self.next_byte().is_some_and(|b| b & 0xC0 == 0x80) {
                self.current_line_start_position = self.current_line_start_position.wrapping_sub(1);
            }
        } else if byte & 0xC0 == 0x80 {
            self.current_line_start_position = self.current_line_start_position.wrapping_add(1);
        }
    }

    #[inline]
    pub(crate) fn byte_at(&self, n: usize) -> u8 {
        self.src[self.position + n]
    }

    #[inline]
    pub(crate) fn next_byte(&self) -> Option<u8> {
        if self.is_eof() {
            return None;
        }
        Some(self.src[self.position])
    }

    #[inline]
    pub(crate) fn next_char(&self) -> u32 {
        let len = strings::utf8_byte_sequence_length(self.src[self.position]);
        let mut p = [0u8; 4];
        let avail = (self.src.len() - self.position).min(4);
        p[..avail].copy_from_slice(&self.src[self.position..self.position + avail]);
        strings::decode_wtf8_rune_t::<u32>(p, len, strings::UNICODE_REPLACEMENT)
    }

    #[inline]
    pub(crate) fn next_byte_unchecked(&self) -> u8 {
        self.src[self.position]
    }

    #[inline]
    pub(crate) fn slice_from(&self, start: usize) -> &'static [u8] {
        // SAFETY: see `src_str` — slice borrows `self.src: &'a [u8]` which the
        // returned `Token` never outlives. `'static` is a placeholder for the
        // not-yet-threaded `'bump`/`'input` lifetime.
        unsafe { src_str(&self.src[start..self.position]) }
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

fn byte_to_decimal_digit(b: u8) -> Option<u32> {
    if b >= b'0' && b <= b'9' {
        Some(u32::from(b - b'0'))
    } else {
        None
    }
}

pub(crate) fn split_source_map(contents: &[u8]) -> Option<&[u8]> {
    // A byte scan suffices: the delimiters are all ASCII and ASCII bytes never
    // occur inside a multi-byte UTF-8 sequence. The returned slice ends *after*
    // the matched byte — hence `i + 1`.
    for (i, &c) in contents.iter().enumerate() {
        match c {
            b' ' | b'\t' | FORM_FEED_BYTE | b'\r' | b'\n' => {
                return Some(&contents[0..i + 1]);
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

// Data layout hoisted at crate root (lib.rs) so error.rs can name `Token`
// without the parser hub. Behavior impls (kind/is_parse_error/to_css_generic)
// live here. TODO: make strings be allocated in string pool.
// TODO: lifetime — every &[u8] payload borrows the arena/source. Uses
// `&'static [u8]` placeholder; thread `<'a>` once payload lifetimes settle.
pub use crate::Token;

impl Token {
    pub fn eql(lhs: &Token, rhs: &Token) -> bool {
        // TODO: derive PartialEq once payload lifetimes settle.
        generic::implement_eql(lhs, rhs)
    }

    pub fn hash(&self, hasher: &mut bun_wyhash::Wyhash) {
        generic::implement_hash(self, hasher)
    }

    /// Return whether this token represents a parse error.
    pub(crate) fn is_parse_error(&self) -> bool {
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
    pub(crate) fn kind(&self) -> TokenKind {
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

    pub fn raw(&self) -> &[u8] {
        match self {
            Token::Ident(v) => v,
            // .function => ...
            _ => unreachable!(),
        }
    }

    pub(crate) fn to_css_generic<W: WriteAll + ?Sized>(
        &self,
        writer: &mut W,
    ) -> bun_io::Result<()> {
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
            Token::Percentage {
                unit_value,
                int_value,
                has_sign,
            } => {
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

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            Token::Ident(value) => dest.serialize_identifier(value),
            Token::AtKeyword(value) => {
                dest.write_str("@")?;
                dest.serialize_identifier(value)
            }
            Token::UnrestrictedHash(value) => {
                dest.write_str("#")?;
                dest.serialize_name(value)
            }
            Token::IdHash(value) => {
                dest.write_str("#")?;
                dest.serialize_identifier(value)
            }
            Token::QuotedString(value) => dest.serialize_string(value),
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
            Token::Number(num) => {
                serializer::write_numeric(num.value, num.int_value, num.has_sign, dest)
                    .map_err(|_| dest.add_fmt_error())
            }
            Token::Percentage {
                unit_value,
                int_value,
                has_sign,
            } => {
                serializer::write_numeric(*unit_value * 100.0, *int_value, *has_sign, dest)
                    .map_err(|_| dest.add_fmt_error())?;
                dest.write_str("%")
            }
            Token::Dimension(dim) => {
                serializer::write_numeric(dim.num.value, dim.num.int_value, dim.num.has_sign, dest)
                    .map_err(|_| dest.add_fmt_error())?;
                let unit = dim.unit;
                if unit == b"e"
                    || unit == b"E"
                    || unit.starts_with(b"e-")
                    || unit.starts_with(b"E-")
                {
                    dest.write_str("\\65 ")?;
                    dest.serialize_name(&unit[1..])
                } else {
                    dest.serialize_identifier(unit)
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
                dest.serialize_identifier(name)?;
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

// `impl Display for Token` lives at crate root (lib.rs) — minimal rendering
// for error messages only. The CSS-serialization-correct form is
// `Token::to_css_generic` above.

/// Byte-writer trait for `serializer` and `to_css_generic`.
/// Aliased to the canonical `bun_io::Write`; the associated
/// `type Error` is dropped — every `Result<(), W::Error>` becomes
/// `bun_io::Result<()>`. `Vec<u8>` / `ArenaVec<'_, u8>` / `Printer` all
/// implement it upstream.
pub use bun_io::Write as WriteAll;

// Num/Dimension data layouts hoisted at crate root (lib.rs).
pub use crate::{Dimension, Num};

// Num/Dimension eql/hash gated until generics::CssEql/CssHash blanket impls
// cover the float/slice payloads.

impl Num {
    pub fn eql(lhs: &Num, rhs: &Num) -> bool {
        generic::implement_eql(lhs, rhs)
    }
    pub(crate) fn hash(&self, hasher: &mut bun_wyhash::Wyhash) {
        generic::implement_hash(self, hasher)
    }
}

impl Dimension {
    pub fn eql(lhs: &Self, rhs: &Self) -> bool {
        generic::implement_eql(lhs, rhs)
    }
    pub(crate) fn hash(&self, hasher: &mut bun_wyhash::Wyhash) {
        generic::implement_hash(self, hasher)
    }
}

pub(crate) enum CopyOnWriteStr<'a> {
    Borrowed(&'a [u8]),
    Owned(bun_alloc::ArenaVec<'a, u8>),
}

impl<'a> CopyOnWriteStr<'a> {
    pub(crate) fn append(&mut self, arena: &'a Bump, slice: &[u8]) {
        match self {
            CopyOnWriteStr::Borrowed(b) => {
                let mut list = bun_alloc::ArenaVec::with_capacity_in(b.len() + slice.len(), arena);
                list.extend_from_slice(b);
                list.extend_from_slice(slice);
                *self = CopyOnWriteStr::Owned(list);
            }
            CopyOnWriteStr::Owned(o) => {
                o.extend_from_slice(slice);
            }
        }
    }

    pub(crate) fn to_slice(self) -> &'static [u8] {
        match self {
            // SAFETY: see `src_str` — both arms borrow either the source or
            // arena, neither of which the consuming `Token` outlives.
            CopyOnWriteStr::Borrowed(b) => unsafe { src_str(b) },
            // SAFETY: `into_bump_slice` leaks the buffer into the arena so it
            // lives for `'a`; otherwise dropping the Vec would `mi_free` it.
            CopyOnWriteStr::Owned(o) => unsafe { src_str(o.into_bump_slice()) },
        }
    }
}

// ───────────────────────────── color ─────────────────────────────

pub mod color {
    /// The opaque alpha value of 1.0.
    pub(crate) const OPAQUE: f32 = 1.0;

    #[derive(Debug, strum::IntoStaticStr)]
    pub enum ColorError {
        Parse,
    }
    impl core::fmt::Display for ColorError {
        fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
            f.write_str("parse")
        }
    }
    impl core::error::Error for ColorError {}

    /// Either an angle or a number.
    pub(crate) enum AngleOrNumber {
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

    bun_core::comptime_string_map! {
    pub static NAMED_COLORS: RGB = {
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
    }

    /// Returns the named color with the given name.
    /// <https://drafts.csswg.org/css-color-4/#typedef-named-color>
    pub(crate) fn parse_named_color(ident: &[u8]) -> Option<(u8, u8, u8)> {
        NAMED_COLORS.get(ident).copied()
    }

    /// Parse a color hash, without the leading '#' character.
    pub(crate) fn parse_hash_color(value: &[u8]) -> Option<(u8, u8, u8, f32)> {
        parse_hash_color_impl(value).ok()
    }

    pub(crate) fn parse_hash_color_impl(value: &[u8]) -> Result<(u8, u8, u8, f32), ColorError> {
        let pair = |i: usize| {
            bun_core::fmt::hex_pair_value(value[i], value[i + 1]).ok_or(ColorError::Parse)
        };
        match value.len() {
            8 => Ok((pair(0)?, pair(2)?, pair(4)?, pair(6)? as f32 / 255.0)),
            6 => Ok((pair(0)?, pair(2)?, pair(4)?, OPAQUE)),
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

    #[inline]
    pub(crate) fn from_hex(c: u8) -> Result<u8, ColorError> {
        bun_core::fmt::hex_digit_value(c).ok_or(ColorError::Parse)
    }

    /// <https://drafts.csswg.org/css-color/#hsl-color> except with h
    /// pre-multiplied by 3, to avoid some rounding errors.
    pub(crate) fn hsl_to_rgb(hue: f32, saturation: f32, lightness: f32) -> (f32, f32, f32) {
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

pub(crate) mod serializer {
    use super::*;

    /// Write a CSS name, like a custom property name.
    pub(crate) fn serialize_name<W: WriteAll + ?Sized>(
        value: &[u8],
        writer: &mut W,
    ) -> bun_io::Result<()> {
        let mut chunk_start: usize = 0;
        for (i, &b) in value.iter().enumerate() {
            let escaped: Option<&[u8]> = match b {
                b'0'..=b'9' | b'A'..=b'Z' | b'a'..=b'z' | b'_' | b'-' => continue,
                // the unicode replacement character
                0 => Some(REPLACEMENT_CHAR_UTF8),
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
    pub(crate) fn serialize_string<W: WriteAll + ?Sized>(
        value: &[u8],
        writer: &mut W,
    ) -> bun_io::Result<()> {
        writer.write_all(b"\"")?;
        let mut sw = CssStringWriter::new(writer);
        sw.write_str(value)?;
        writer.write_all(b"\"")
    }

    pub(crate) fn serialize_dimension(
        value: f32,
        unit: &'static [u8],
        dest: &mut Printer,
    ) -> Result<(), PrintErr> {
        let int_value: Option<i32> = if fract(value) == 0.0 {
            Some(value as i32) // saturating cast
        } else {
            None
        };
        let token = Token::Dimension(Dimension {
            num: Num {
                has_sign: value < 0.0,
                value,
                int_value,
            },
            unit,
        });
        if value != 0.0 && value.abs() < 1.0 {
            // TODO: calculate the actual number of chars here
            let mut buf = [0u8; 64];
            let mut fbs = FixedBufWriter::new(&mut buf);
            token
                .to_css_generic(&mut fbs)
                .map_err(|_| dest.add_fmt_error())?;
            let s = fbs.get_written();
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
    pub(crate) fn serialize_identifier<W: WriteAll + ?Sized>(
        value: &[u8],
        writer: &mut W,
    ) -> bun_io::Result<()> {
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

    pub(crate) fn serialize_unquoted_url<W: WriteAll + ?Sized>(
        value: &[u8],
        writer: &mut W,
    ) -> bun_io::Result<()> {
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

    pub(crate) fn write_numeric<W: WriteAll + ?Sized>(
        value: f32,
        int_value: Option<i32>,
        has_sign: bool,
        writer: &mut W,
    ) -> bun_io::Result<()> {
        // `value >= 0` is true for negative 0.
        if has_sign && !value.is_sign_negative() {
            writer.write_all(b"+")?;
        }

        let notation: Notation = if value == 0.0 && value.is_sign_negative() {
            // Negative zero. Work around #20596.
            writer.write_all(b"-0")?;
            Notation {
                decimal_point: false,
                scientific: false,
            }
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

    pub(crate) fn hex_escape<W: WriteAll + ?Sized>(
        ascii_byte: u8,
        writer: &mut W,
    ) -> bun_io::Result<()> {
        let bytes: [u8; 4];
        let slice: &[u8] = if ascii_byte > 0x0F {
            let [hi, lo] = bun_core::fmt::hex_byte_lower(ascii_byte);
            bytes = [b'\\', hi, lo, b' '];
            &bytes[0..4]
        } else {
            bytes = [b'\\', bun_core::fmt::hex_char_lower(ascii_byte), b' ', 0];
            &bytes[0..3]
        };
        writer.write_all(slice)
    }

    pub(crate) fn char_escape<W: WriteAll + ?Sized>(
        ascii_byte: u8,
        writer: &mut W,
    ) -> bun_io::Result<()> {
        let bytes = [b'\\', ascii_byte];
        writer.write_all(&bytes)
    }

    pub(crate) struct CssStringWriter<'w, W: WriteAll + ?Sized> {
        inner: &'w mut W,
    }

    impl<'w, W: WriteAll + ?Sized> CssStringWriter<'w, W> {
        /// Wrap a text writer to create a `CssStringWriter`.
        pub(crate) fn new(inner: &'w mut W) -> Self {
            Self { inner }
        }

        pub(crate) fn write_str(&mut self, str: &[u8]) -> bun_io::Result<()> {
            let mut chunk_start: usize = 0;
            for (i, &b) in str.iter().enumerate() {
                let escaped: Option<&[u8]> = match b {
                    b'"' => Some(b"\\\""),
                    b'\\' => Some(b"\\\\"),
                    // replacement character
                    0 => Some(REPLACEMENT_CHAR_UTF8),
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

    /// Fixed-buffer writer for `serialize_dimension` — alias for the canonical
    /// `bun_io::FixedBufferStream`. Callers use `.get_written()` (was `.buffered()`).
    pub(crate) type FixedBufWriter<'a> = bun_io::FixedBufferStream<&'a mut [u8]>;
}

// ───────────────────────────── misc utilities ─────────────────────────────

pub(crate) mod parse_utility {
    use super::*;

    /// Parse a value from a string.
    ///
    /// NOTE: `input` should live as long as the returned value. Otherwise,
    /// strings in the returned parsed value will point to undefined memory.
    pub(crate) fn parse_string<T>(
        arena: &Bump,
        input: &[u8],
        parse_one: fn(&mut Parser) -> CssResult<T>,
    ) -> CssResult<T> {
        // I hope this is okay
        let mut import_records = Vec::<ImportRecord>::default();
        let mut i = ParserInput::new(input, arena);
        let mut parser = Parser::new(
            &mut i,
            Some(core::ptr::NonNull::from(&mut import_records)),
            ParserOpts::default(),
            None,
        );
        let result = parse_one(&mut parser)?;
        parser.expect_exhausted()?;
        Ok(result)
    }
}

pub(crate) mod to_css {
    use super::*;

    pub(crate) fn from_list<T: generic::ToCss>(
        this: &[T],
        dest: &mut Printer,
    ) -> Result<(), PrintErr> {
        let len = this.len();
        for (idx, val) in this.iter().enumerate() {
            val.to_css(dest)?;
            if idx < len - 1 {
                dest.delim(b',', false)?;
            }
        }
        Ok(())
    }

    pub(crate) fn integer(this: i32, dest: &mut Printer) -> Result<(), PrintErr> {
        let mut b = bun_core::fmt::ItoaBuf::new();
        dest.write_bytes(bun_core::fmt::itoa(&mut b, this))
    }

    pub(crate) fn float32(this: f32, writer: &mut Printer) -> Result<(), PrintErr> {
        let mut scratch = [0u8; 129];
        let (str, _) = dtoa_short(&mut scratch, this, 6);
        writer.write_bytes(str)
    }
}

/// Parse `!important`.
pub(crate) fn parse_important(input: &mut Parser) -> CssResult<()> {
    input.expect_delim(b'!')?;
    input.expect_ident_matching(b"important")
}

pub(crate) mod signfns {
    /// Note: the ±0.0 sign FLIP is
    /// intentional (do NOT "fix" it). Distinct from `f32::signum` and from
    /// `calc::std_math_sign` / `CSSNumberFns::sign`.
    #[inline]
    pub(crate) fn sign_f32(x: f32) -> f32 {
        if x == 0.0 {
            return if x.is_sign_negative() { 0.0 } else { -0.0 };
        }
        x.signum()
    }
}

#[derive(Clone, Copy)]
pub struct Notation {
    pub(crate) decimal_point: bool,
    pub(crate) scientific: bool,
}

impl Notation {
    pub(crate) fn integer() -> Notation {
        Notation {
            decimal_point: false,
            scientific: false,
        }
    }
}

/// Writes float with precision. Returns `None` notation if value was not finite.
pub fn dtoa_short(buf: &mut [u8; 129], value: f32, precision: u8) -> (&[u8], Option<Notation>) {
    // Only calc() yields non-finite values. CSS Values 4 #calc-ieee: a NaN
    // escaping a top-level calculation is censored to zero; infinities clamp to
    // the largest finite value (https://github.com/oven-sh/bun/issues/18064).
    if value.is_nan() {
        const S: &[u8] = b"0";
        buf[..S.len()].copy_from_slice(S);
        return (&buf[..S.len()], None);
    }
    if value.is_infinite() && value.is_sign_positive() {
        const S: &[u8] = b"3.40282e38";
        buf[..S.len()].copy_from_slice(S);
        return (&buf[..S.len()], None);
    } else if value.is_infinite() && value.is_sign_negative() {
        const S: &[u8] = b"-3.40282e38";
        buf[..S.len()].copy_from_slice(S);
        return (&buf[..S.len()], None);
    }
    let (str, notation) = dtoa_short_impl(buf, value, precision);
    (str, Some(notation))
}

pub(crate) fn dtoa_short_impl(buf: &mut [u8; 129], value: f32, precision: u8) -> (&[u8], Notation) {
    buf[0] = b'0';
    debug_assert!(value.is_finite());
    // bun_core::fmt::FormatDouble::dtoa wants a fixed-size [u8; 124] buffer.
    let buf_len = {
        let inner: &mut [u8; 124] = (&mut buf[1..125])
            .try_into()
            .expect("infallible: size matches");
        bun_core::fmt::FormatDouble::dtoa(inner, value as f64).len()
    };
    restrict_prec(&mut buf[0..buf_len + 1], precision)
}

fn restrict_prec(buf: &mut [u8], prec: u8) -> (&[u8], Notation) {
    let len: u8 = u8::try_from(buf.len()).expect("int cast");

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
        if pos_dot > prec_start && pos_dot <= end {
            end + 1
        } else {
            end
        }
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
pub(crate) fn fract(val: f32) -> f32 {
    val - val.trunc()
}

pub fn f32_length_with_5_digits(n_input: f32) -> usize {
    let mut n = (n_input * 100000.0).round();

    // Huge values (>= ~3.4e33) overflow to infinity when scaled, and infinity
    // never drops below 1.0 no matter how many times it is divided by 10, so
    // the loop below would spin forever. Treat non-finite values as longer
    // than any finite representation.
    if !n.is_finite() {
        return usize::MAX;
    }

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
