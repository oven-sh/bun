//! CSS parser — port of `src/css/css_parser.zig`.
//!
//! This is an AST crate (see PORTING.md §Allocators): allocations are
//! arena-backed in the Zig original. Phase A keeps `&'bump Bump` threading
//! where it matters and drops `Allocator` params elsewhere.

use bun_alloc::ArenaVecExt as _;
use core::fmt;

use bun_alloc::Arena as Bump;
use bun_ast::Log;
use bun_collections::bit_set::{ArrayBitSet, num_masks_for};
use bun_collections::{ArrayHashMap, MapEntry, VecExt};
use bun_core::strings;

// ───────────────────────────── re-exports ─────────────────────────────
//
// B-2 un-gate: the Zig css_parser hub re-exports the entire crate surface.
// Un-gated modules re-export for real; still-gated hubs (rules/, properties/,
// selectors/, declaration, media_query, context) are shimmed below so the
// Parser/Tokenizer core compiles standalone. Shims become `pub use` lines as
// each module un-gates.

/// `bun.ast.Index` — bundler source-file index. Hoisted into
/// `bun_options_types` to keep css below the parser tier.
use bun_ast::Index as SrcIndex;
use bun_ast::symbol::List as SymbolList;
use bun_ast::{ImportKind, ImportRecord};

pub use crate::compat::{self, Feature};
pub use crate::css_modules::{
    self, Config as CssModuleConfig, CssModule, CssModuleExports, CssModuleReference,
    CssModuleReferences,
};
pub use crate::dependencies::{self, Dependency};
pub use crate::error::{
    self as errors_, BasicParseError, BasicParseErrorKind, Err, ErrorLocation, MinifyErr,
    MinifyError, MinifyErrorKind, ParseError, ParserError, PrinterError, PrinterErrorKind,
    SelectorError, fmt_printer_error,
};
pub use crate::generics::{
    self as generic, HASH_SEED, implement_deep_clone, implement_eql, implement_hash,
};
pub use crate::logical::{self, LogicalGroup, PropertyCategory};
pub use crate::prefixes;
pub use crate::printer::{self as css_printer, ImportInfo, Printer, PrinterOptions};
pub use crate::small_list::SmallList;
pub use crate::targets::{self, Features, Targets};

pub use crate::values::{
    self as css_values,
    color::CssColor,
    ident::{CustomIdent, CustomIdentList, DashedIdent, Ident},
};

// ── cross-module re-exports (B-2 round 5: un-gated) ──────────────────────
// rules/, selectors/, media_query, declaration, context, properties hubs now
// compile for real (data-layout level). Re-export their surface so the
// rule-parser layer below can name `CssRule`/`SelectorList`/`DeclarationBlock`
// directly. Leaf rule modules (keyframes, page, container, ...) remain
// `gated_rule!`-stubbed inside rules/mod.rs — `gated_shims` below carries the
// handful of types `AtRulePrelude` references that those stubs don't yet
// expose.
pub use crate::context::PropertyHandlerContext;
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
    tailwind::TailwindAtRule,
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

/// Minimal stand-ins for types that live in still-gated sibling *leaf* modules
/// (rules/{keyframes,page,container,...}, values::{number,string}). The hub
/// modules above are real; only the per-rule payload types `AtRulePrelude`
/// reaches into by name remain shimmed here. When a leaf un-gates, delete the
/// matching shim.
mod gated_shims {
    use super::*;

    // ── rules/ leaf-module payload re-exports ────────────────────────────
    // The leaf modules are un-gated; re-export the real prelude payload types
    // `AtRulePrelude` carries so the rule-parser impl bodies type-check
    // against the same structs `CssRule` stores.
    pub use crate::rules::container::{ContainerCondition, ContainerName};
    pub use crate::rules::keyframes::KeyframesName;
    pub use crate::rules::page::PageSelector;

    // ── values::{number,string} ──────────────────────────────────────────
    pub type CSSNumber = f32;
    pub type CSSInteger = i32;
    pub type CSSString = &'static [u8];

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
            pub fn path_init(text: &'static [u8]) -> Path<'static> {
                Path::init(text)
            }
        }
    }
}

// `Maybe` in Zig is `bun.jsc.Node.Maybe` — a tagged result. In Rust we use
// `core::result::Result` directly; callers `.ok()`/`.err()` instead of
// `.asValue()`/`.asErr()`.
pub use core::result::Result as Maybe;

// PrintErr is hoisted at crate root (single-variant `to_css` error signal);
// re-export so `css_parser::PrintErr` resolves for sibling modules.
pub use crate::PrintErr;

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
    pub const ENUM_PROPERTY: &str = "TODO: implement enum_property!";
    pub const MATCH_BYTE: &str = "TODO: implement match_byte!";
    pub const WARN: &str = "TODO: implement warning";
}

// ───────────────────────────── VendorPrefix ─────────────────────────────
// Data layout hoisted at crate root (lib.rs) so leaf modules (targets,
// prefixes) compile without the parser hub. Behavior impls live here.

pub use crate::VendorPrefix;

impl VendorPrefix {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
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
    pub fn to_logger_location(&self, file: &'static [u8]) -> bun_ast::Location {
        bun_ast::Location {
            file: std::borrow::Cow::Borrowed(file),
            line: i32::try_from(self.line).expect("int cast"),
            column: i32::try_from(self.column).expect("int cast"),
            ..Default::default()
        }
    }

    /// Create a new BasicParseError at this location for an unexpected token
    pub fn new_basic_unexpected_token_error(self, token: Token) -> ParseError<ParserError> {
        BasicParseError {
            kind: BasicParseErrorKind::unexpected_token(token),
            location: self,
        }
        .into_default_parse_error()
    }

    /// Create a new ParseError at this location for an unexpected token
    pub fn new_unexpected_token_error(self, token: Token) -> ParseError<ParserError> {
        ParseError {
            kind: errors_::ParserErrorKind::basic(BasicParseErrorKind::unexpected_token(token)),
            location: self,
        }
    }

    // PORT NOTE: Zig used `anytype` + `@TypeOf` to dispatch on
    // `ParserError | BasicParseError | SelectorParseErrorKind`. In Rust this
    // becomes a trait `IntoParserError` implemented by each live variant
    // (the `BasicParseError` arm is dead/ill-typed in Zig — see note below).
    pub fn new_custom_error(self, err: impl IntoParserError) -> ParseError<ParserError> {
        ParseError {
            kind: errors_::ParserErrorKind::custom(err.into_parser_error()),
            location: self,
        }
    }
}

/// Dispatch trait for `SourceLocation::new_custom_error` (replaces Zig
/// `anytype` switch on `@TypeOf`).
pub trait IntoParserError {
    fn into_parser_error(self) -> ParserError;
}
impl IntoParserError for ParserError {
    #[inline]
    fn into_parser_error(self) -> ParserError {
        self
    }
}
// PORT NOTE: Zig's `newCustomError` had a third `@TypeOf` arm for
// `BasicParseError`, but that arm is dead and ill-typed — it wraps
// `BasicParseError.intoDefaultParseError(err)` (a `ParseError(ParserError)`)
// in `.custom`, which expects a `ParserError`. No caller ever passes
// `BasicParseError`, so Zig's lazy comptime never instantiates it. We
// intentionally do NOT impl `IntoParserError` for `BasicParseError` here.
// `SelectorParseErrorKind` is impl'd in `selectors/parser.rs`.

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
///
/// PORT NOTE: Zig's `DefineShorthand` bodies are `@compileError(todo_stuff.depth)`
/// — i.e. instantiating the comptime fn and reaching any method is a compile
/// error. The faithful Rust mapping is a trait with **no default bodies**: any
/// `impl DefineShorthand for T` that omits a method fails at compile time, same
/// as the Zig. Per-type bodies are emitted by `#[derive(DefineShorthand)]`
/// using the (currently commented-out) `PropertyFieldMap`/`VendorPrefixMap`
/// reflection algorithm in `css_parser.zig` lines 316–500.
pub trait DefineShorthand: Sized {
    /// The shorthand's own `PropertyIdTag` (Zig: `comptime property_name`).
    const PROPERTY_NAME: PropertyIdTag;

    /// Returns a shorthand from the longhand properties defined in the given
    /// declaration block, plus whether all matched longhands were `!important`.
    ///
    /// Derive walks `decls.declarations` then `decls.important_declarations`;
    /// for each property, matches its `PropertyIdTag` against each field's
    /// mapped tag (and vendor prefix where applicable), deep-clones the value
    /// into the corresponding field, and tracks a per-field set bitmask. If any
    /// field's prefix mismatches, returns `None`. If `important_count > 0 &&
    /// important_count != count`, returns `None`. Returns `Some((self, important))`
    /// only when every field was set.
    fn from_longhands(
        decls: &DeclarationBlock,
        vendor_prefix: VendorPrefix,
    ) -> Option<(Self, bool)>;

    /// Returns the longhand `PropertyId`s this shorthand expands to, in field
    /// declaration order. Derive emits a `const` array of
    /// `PropertyId::<field>{ vendor_prefix }` (prefix only for fields present
    /// in `VendorPrefixMap`).
    fn longhands(vendor_prefix: VendorPrefix) -> &'static [PropertyId];

    /// Returns a single longhand `Property` for this shorthand, given its id.
    /// Derive matches `property_id`'s tag against each field's mapped tag,
    /// deep-clones the field value, and wraps it in the corresponding
    /// `Property::<field>` variant (paired with the prefix when vendor-mapped).
    /// Returns `None` if no field matches.
    fn longhand(&self, property_id: &PropertyId) -> Option<Property>;

    /// Updates this shorthand from a longhand property. Derive matches
    /// `property`'s tag against each field's mapped tag and deep-clones the
    /// payload into the field. Returns `true` on match, `false` otherwise.
    fn set_longhand(&mut self, property: &Property) -> bool;
}

// PORT NOTE: Zig's `DefineListShorthand` / `DefineRectShorthand` /
// `DefineSizeShorthand` / `DeriveParse` / `DeriveToCss` comptime fns became
// proc-macros (`bun_css_derive::*`, re-exported below) plus the
// `impl_rect_shorthand!` / `impl_size_shorthand!` macros in
// `properties/margin_padding.rs`. The placeholder trait stubs that previously
// mirrored their `parse`/`to_css` signatures were dead (zero impls/bounds) and
// duplicated `generics::{Parse, ToCss}`, so they were removed.

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
        let ident = input.expect_ident_cloned()?;
        if let Some(x) = T::from_ascii_case_insensitive(ident) {
            return Ok(x);
        }
        Err(location.new_unexpected_token_error(Token::Ident(ident)))
    }

    pub fn to_css<T: Into<&'static str> + Copy>(
        this: &T,
        dest: &mut Printer,
    ) -> Result<(), PrintErr> {
        dest.write_str(as_str(this).as_bytes())
    }
}

// Derive macros for the comptime helpers above. Re-exported here as well as
// at crate root because some leaf modules alias `crate::css_parser as css`
// (Zig's `css.DefineEnumProperty(...)` lived in this file).
pub use bun_css_derive::{DefineEnumProperty, Parse, ToCss};

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
    // PERF(port): was SmallList<BlockType, 16> + appendAssumeCapacity — Vec is
    // fine for the cold path; profile in Phase B.
    let mut stack: Vec<BlockType> = Vec::with_capacity(16);
    stack.push(block_type);

    while let Ok(tok) = tokenizer.next() {
        if let Some(b) = BlockType::closing(&tok) {
            if *stack.last().unwrap() == b {
                let _ = stack.pop();
                if stack.is_empty() {
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

    // TODO(port): lifetime — `name` borrows the input arena. The detach is the
    // same `'static` erasure already applied to `Token`/`AtRulePrelude::Unknown`.
    let name: &'static [u8] = unsafe { &*std::ptr::from_ref::<[u8]>(name) };
    options.warn(input.new_error(BasicParseErrorKind::at_rule_invalid(name)));
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
    if let Err(e) = input.expect_curly_bracket_block() {
        return Err(e);
    }
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
    // PORT NOTE: reshaped for borrowck — Zig held `parser.input` aliased
    // between the outer Parser and a stack-local "delimited" Parser. In Rust
    // `&'a mut ParserInput<'a>` is invariant and cannot be reborrowed into a
    // second `Parser<'a>` while the first lives. We instead temporarily swap
    // `stop_before` on the *same* Parser, run the inner parse, and restore.
    // `at_start_of` is *moved into* the inner parse (Zig moved it into the
    // delimited Parser and left the outer null) — since we reuse the same
    // Parser it carries through unchanged, and is consumed/cleared below
    // rather than restored.
    let saved_stop_before = parser.stop_before;
    parser.stop_before = delimiters;
    let result = {
        let result = parser.parse_entirely(closure, parse_fn);
        if matches!(error_behavior, ParseUntilErrorBehavior::Stop) && result.is_err() {
            parser.stop_before = saved_stop_before;
            // Match Zig: the delimited parser *moved* `at_start_of` out of the
            // outer parser (`parser.at_start_of = null;`). Since we reuse the
            // same Parser, explicitly clear it so the caller doesn't observe a
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
    // PORT NOTE: reshaped for borrowck — same aliasing as parse_until_before.
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

#[derive(Default, Clone, Copy, crate::DeepClone)]
pub struct DefaultAtRule;

impl DefaultAtRule {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        dest.new_error(PrinterErrorKind::fmt_error, None)
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

    /// Move the registered `@layer` names accumulated via `on_layer_rule` out
    /// of the parser. The Zig spec only populates `StyleSheet.layer_names`
    /// when `P == BundlerAtRuleParser` (css_parser.zig:3324); Rust can't
    /// type-specialize at the call site, so this is a trait hook with a
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
    pub arena: &'a Bump,
    /// Raw pointer aliasing the same `Vec` that `Parser.import_records`
    /// points to (Zig passes one `*Vec` to both — see `parseBundler`,
    /// css_parser.zig:3245). Both views are raw pointers sharing a single
    /// SharedRW provenance (see `parse_bundler`); each materialises a
    /// short-lived `&mut` only at the point of use, so accesses interleave
    /// soundly under Stacked Borrows.
    pub import_records: *mut Vec<ImportRecord>,
    pub layer_names: Vec<LayerName>,
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
        // TODO(port): tailwind branch.
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
            module_id: 0,
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
                // PERF(port): was appendSliceAssumeCapacity — `SmallList` has no
                // public `reserve`, so two `append_slice` calls each grow once.
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

    fn set_enclosing_layer(this: &mut Self, layer: LayerName) {
        this.enclosing_layer = layer;
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
// B-2 round 5: un-gated. Variant payload types are now real (rules/ +
// selectors/ + media_query/ hubs compile). The few leaf-module payload types
// not yet exposed by `rules/mod.rs` (KeyframesName, PageSelector,
// ContainerName, ContainerCondition) come from `gated_shims` above.

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
        // TODO(port): real type is `css_rules::keyframes::KeyframesName` —
        // leaf module gated in rules/mod.rs.
        name: KeyframesName,
        prefix: VendorPrefix,
    },
    // TODO(port): real type is `Vec<css_rules::page::PageSelector>` — gated.
    Page(Vec<PageSelector>),
    MozDocument,
    Layer(SmallList<LayerName, 1>),
    Container {
        // TODO(port): real types in `css_rules::container` — gated.
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
    // PORT NOTE: Zig threaded `input.arena()` at every call site; the Rust
    // `DeclarationList = bumpalo::Vec<'bump, Property>` needs the arena up
    // front, so cache it here (same `'static`-erased borrow `DeclarationBlock`
    // already uses crate-wide).
    pub arena: &'a Bump,
    pub options: &'a ParserOptions<'a>,
    pub state: TopLevelState,
    pub at_rule_parser: &'a mut AtRuleParserT,
    // TODO: think about memory management
    pub rules: &'a mut CssRuleList<AtRuleParserT::AtRule>,
    pub composes: &'a mut ComposesMap,
    pub composes_refs: SmallList<ast::Ref, 2>,
    pub local_properties: &'a mut LocalPropertyUsage,
}

impl<'a, AtRuleParserT: CustomAtRuleParser> TopLevelRuleParser<'a, AtRuleParserT> {
    pub fn new(
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

    pub fn nested(&mut self) -> NestedRuleParser<'_, AtRuleParserT> {
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

/// Dispatch trait for `parse_declaration_impl` (replaces Zig
/// `composes_ctx: anytype`). Implemented by `NestedRuleParser`.
pub trait ComposesCtx {
    fn composes_state(&self) -> ComposesState;
    fn record_composes(&mut self, composes: &mut Composes);
}
/// Unit `ComposesCtx` for callers that don't track `composes:` (Zig `void`).
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
    pub arena: &'a Bump,
    pub options: &'a ParserOptions<'a>,
    pub at_rule_parser: &'a mut T,
    // todo_stuff.think_mem_mgmt
    // PORT NOTE: `DeclarationList<'bump>` borrows the parser arena. Threading
    // `'bump` here cascades into every rule type; deferred (matches
    // `StyleRule`'s `'static` erasure in rules/style.rs).
    pub declarations: DeclarationList<'static>,
    // todo_stuff.think_mem_mgmt
    pub important_declarations: DeclarationList<'static>,
    // todo_stuff.think_mem_mgmt
    pub rules: &'a mut CssRuleList<T::AtRule>,
    pub is_in_style_rule: bool,
    pub allow_declarations: bool,

    pub composes_state: ComposesState,
    pub composes_refs: &'a mut SmallList<ast::Ref, 2>,
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

pub struct StyleSheetParser<'i, 't, P: AtRuleParser + QualifiedRuleParser> {
    pub input: &'i mut Parser<'t>,
    pub parser: &'i mut P,
    pub any_rule_so_far: bool,
}

impl<'i, 't, P> StyleSheetParser<'i, 't, P>
where
    P: AtRuleParser + QualifiedRuleParser<QualifiedRule = <P as AtRuleParser>::AtRule>,
{
    pub fn new(input: &'i mut Parser<'t>, parser: &'i mut P) -> Self {
        Self {
            input,
            parser,
            any_rule_so_far: false,
        }
    }

    pub fn next(&mut self) -> Option<CssResult<<P as AtRuleParser>::AtRule>> {
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
                        .parse_until_after(delimiters, |p| Parser::parse_empty(p));
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
// Un-gated: `declaration::parse_declaration_impl` + `selectors::parser` are
// real, so the `QualifiedRuleParser`/`DeclarationParser`/`RuleBodyItemParser`
// surface and `parse_nested`/`parse_style_block` compile end-to-end. The
// at-rule arms now call the leaf-module parse fns directly (`LayerName`,
// `SupportsCondition`, `KeyframesName`, `PageSelector`, `ContainerName`,
// `ContainerCondition`, `FontPaletteValuesRule`, `PageRule`, `PropertyRule`
// have un-gated). Only `@font-face`/`@keyframes` block bodies remain
// inline-``-gated on their `RuleBodyItemParser` trait impls.
mod rule_parsers {
    use super::*;
    use crate::selectors::parser as selector_parser;

    // PORT NOTE: Zig threaded `composes_ctx: anytype` (pointer to the
    // `NestedRuleParser`) directly into `parse_declaration`. Rust's borrow checker
    // forbids passing `&mut *this` while also borrowing `this.declarations` /
    // `this.important_declarations`, so split-borrow the three composes fields
    // into a small adaptor that implements the `ComposesCtx` dispatch trait.
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
                let entry = self
                    .composes
                    .entry(*ref_)
                    .or_insert_with(ComposesEntry::default);
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
            // phf-style dispatch on at-rule name (case-insensitive).
            // Zig used `bun.ComptimeEnumMap(PreludeEnum)`.
            crate::match_ignore_ascii_case! { name, {
                b"import" => {
                    if (this.state as u8) > (TopLevelState::Imports as u8) {
                        return Err(input.new_custom_error(ParserError::unexpected_import_rule));
                    }
                    // TODO(port): lifetime — arena-owned slice; same `'static` erasure
                    // as `Token` payloads.
                    let url_str: &'static [u8] =
                        unsafe { &*std::ptr::from_ref::<[u8]>(input.expect_url_or_string()?) };

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
                            p.expect_ident()
                                .map(|s| -> &'static [u8] { unsafe { &*std::ptr::from_ref::<[u8]>(s) } })
                        })
                        .ok();
                    let namespace: &'static [u8] =
                        unsafe { &*std::ptr::from_ref::<[u8]>(input.expect_url_or_string()?) };
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
        pub fn parse_nested(
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
            // PORT NOTE: reshaped for borrowck — Zig held `self.*` aliased. Spell
            // out the impl with a fresh lifetime so `nested_parser` isn't forced
            // to borrow `rules` for `'a`.
            let parse_declarations =
                <NestedRuleParser<'_, T> as RuleBodyItemParser>::parse_declarations(&nested_parser);
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

        pub fn parse_style_block(
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
                        selectors: SelectorList::from_selector(Selector::from_component(
                            Component::Nesting,
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
            // TODO(port): lifetime — `name` borrows the input arena. Detach to
            // `'static` to feed `BasicParseErrorKind::at_rule_invalid` (matches the
            // `Token` payload erasure throughout this file).
            let name: &'static [u8] = unsafe { &*std::ptr::from_ref::<[u8]>(name) };
            let result: Self::Prelude = 'brk: {
                // Zig `ComptimeEnumMap(PreludeEnum)` ASCII-CI dispatch.
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
                        // Zig: tryParse(parseCommaSeparated(PageSelector.parse)) → on
                        // .err returns empty list. EOF inside `PageSelector::parse`
                        // (e.g. `@page foo` with nothing after) propagates here and is
                        // swallowed by `try_parse` — matches css_parser.zig:2073.
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
                        this.options.warn(input.new_custom_error(ParserError::deprecated_nest_rule));
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
                    // blocked_on: `FontFaceDeclarationParser: RuleBodyItemParser`
                    // trait impls (rules/font_face.rs gated const block).
                    {
                        let mut decl_parser = css_rules::font_face::FontFaceDeclarationParser;
                        let mut parser = RuleBodyParser::new(input, &mut decl_parser);
                        // todo_stuff.think_mem_mgmt
                        // PERF(port): was arena bulk-free — profile in Phase B
                        let mut properties: Vec<css_rules::font_face::FontFaceProperty> =
                            Vec::new();
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
                    // blocked_on: `KeyframesListParser: RuleBodyItemParser` trait
                    // impls (rules/keyframes.rs gated const block).
                    {
                        let mut parser = css_rules::keyframes::KeyframesListParser;
                        let mut iter = RuleBodyParser::new(input, &mut parser);
                        // todo_stuff.think_mem_mgmt
                        // PERF(port): was arena bulk-free — profile in Phase B
                        let mut keyframes: Vec<css_rules::keyframes::Keyframe> = Vec::new();
                        while let Some(result) = iter.next() {
                            if let Ok(keyframe) = result {
                                keyframes.push(keyframe);
                            }
                        }
                        this.rules.v.push(CssRule::Keyframes(
                            css_rules::keyframes::KeyframesRule {
                                name,
                                keyframes,
                                vendor_prefix: prefix,
                                loc,
                            },
                        ));
                        Ok(())
                    }
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
                    // PORT NOTE (css_parser.zig:2393): Zig reads
                    // `prelude.layer.at(0).*` — a struct copy that leaves the list
                    // intact — *then* calls `onLayerRule(&prelude.layer)` so the
                    // hook still observes the 1-element list. Mirror that: clone
                    // slot 0 for the rule's `name`, fire `on_layer_rule`, then
                    // drain the original into `push_to_enclosing_layer`.
                    let name = if layer.len() == 0 {
                        None
                    } else if layer.len() == 1 {
                        // `LayerName` has no `Clone` impl yet; `deep_clone` is the
                        // arena-threaded shallow copy (segments are arena-borrowed
                        // `&[u8]`, so this is the same field-walk Zig's `*` did).
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
            // PORT NOTE: Zig `defer this.composes_refs.clearRetainingCapacity();`.
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
                // SAFETY: see PORT NOTE above — no aliasing borrow live at drop.
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
                // blocked_on: `fill_property_bit_set` (Property variant reflection
                // — properties_generated PropertyIdTag conversions). The type
                // structure is real; only the bitset population stays gated.
                {
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
            // PORT NOTE: split-borrow — see `NestedComposesCtx` above.
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

    /// `MediaList::parse` thunk. The body lives in `media_query.rs` in Zig; the
    /// Rust port hasn't landed it yet. Kept local so the rule-parser arms above
    /// type-check; becomes a one-line `MediaList::parse(input, options)` forwarder
    /// once `media_query::MediaList::parse` un-gates.
    // blocked_on: media_query::{MediaList,MediaQuery}::parse
    #[inline]
    fn parse_media_list(input: &mut Parser, options: &ParserOptions) -> CssResult<MediaList> {
        {
            return MediaList::parse(input, options);
        }
        let _ = (input, options);
        todo("MediaList::parse — media_query.rs parse surface gated")
    }
} // mod rule_parsers

/// A result returned from `to_css`, including the serialized CSS and other
/// metadata depending on the input options.
pub struct ToCssResult {
    /// Serialized CSS code.
    pub code: Vec<u8>,
    /// A map of CSS module exports, if the `css_modules` option was enabled
    /// during parsing.
    // TODO(port): arena lifetime — CssModuleExports/References borrow the
    // parser arena. `'static` placeholder until `<'bump>` threads.
    pub exports: Option<CssModuleExports<'static>>,
    /// A map of CSS module references, if the `css_modules` config had
    /// `dashed_idents` enabled.
    pub references: Option<CssModuleReferences<'static>>,
    /// A list of dependencies (e.g. `@import` or `url()`) found in the style
    /// sheet, if the `analyze_dependencies` option is enabled.
    pub dependencies: Option<Vec<Dependency>>,
}

pub struct ToCssResultInternal {
    pub exports: Option<CssModuleExports<'static>>,
    pub references: Option<CssModuleReferences<'static>>,
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
        Self {
            targets: targets::Targets::default(),
            unused_symbols: ArrayHashMap::default(),
        }
    }
}

pub type BundlerStyleSheet = StyleSheet<BundlerAtRule>;
pub type BundlerCssRuleList = CssRuleList<BundlerAtRule>;
pub type BundlerCssRule = CssRule<BundlerAtRule>;
pub type BundlerLayerBlockRule = css_rules::layer::LayerBlockRule<BundlerAtRule>;
pub type BundlerSupportsRule = css_rules::supports::SupportsRule<BundlerAtRule>;
pub type BundlerMediaRule = css_rules::media::MediaRule<BundlerAtRule>;
// blocked_on: printer.rs PrintResult<R> generic
pub type BundlerPrintResult = PrintResult<BundlerAtRule>;

pub struct BundlerTailwindState {
    pub source: Box<[u8]>,
    pub index: SrcIndex,
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

    pub fn to_real_ref(self, source_index: u32) -> bun_ast::Ref {
        // Spec (css_parser.zig) constructs `Ref{ .tag = .symbol, ... }`.
        bun_ast::Ref::new(self.inner_index(), source_index, bun_ast::RefTag::Symbol)
    }
}

pub struct LocalEntry {
    pub ref_: CssRef,
    pub loc: bun_ast::Loc,
}

/// If css modules is enabled, this maps locally scoped class names to their
/// ref. We use this ref as a layer of indirection during the bundling stage
/// because we don't know the final generated class names for local scope
/// until print time.
pub type LocalScope = ArrayHashMap<Box<[u8]>, LocalEntry>;
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
    pub custom_properties: Box<[&'static [u8]]>, // TODO(port): lifetime — arena slices
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
    pub fn fill(&mut self, used: &PropertyBitset, custom_properties: &[&'static [u8]]) {
        self.bitset.set_union(used);
        // TODO(port): lifetime — Zig stored borrowed slice; box for now.
        self.custom_properties = custom_properties.to_vec().into_boxed_slice();
    }
}

// TODO(port): Zig: `std.bit_set.ArrayBitSet(usize, ceilPow2(EnumFields(PropertyIdTag).len))`.
// Phase B computes the variant count via `strum::EnumCount`.
pub type PropertyBitset = ArrayBitSet<1024, { num_masks_for(1024) }>;

pub fn fill_property_bit_set(
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
                let name: &'static [u8] = unsafe { &*std::ptr::from_ref::<[u8]>(c.name.as_str()) };
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
                let name: &'static [u8] = unsafe { &*std::ptr::from_ref::<[u8]>(c.name.as_str()) };
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
// B-2 round 5: struct un-gated. `CssRuleList`/`LayerName`/`ParserOptions` are
// real. The behavior surface (`parse`/`minify`/`to_css`/`pluck_imports`) stays
// gated below — it bottoms out on `rule_parsers` impl bodies (gated),
// `CssRuleList::{minify,to_css}` (gated in rules/mod.rs),
// `DeclarationHandler` per-property fields (gated), and `Printer::new`
// signature reshape.

pub struct StyleSheet<AtRule> {
    /// A list of top-level rules within the style sheet.
    pub rules: CssRuleList<AtRule>,
    // PERF(port): was arena bulk-free — profile in Phase B (sources /
    // source_map_urls / license_comments were ArrayList fed input.arena()).
    pub sources: Vec<Box<[u8]>>,
    pub source_map_urls: Vec<Option<Box<[u8]>>>,
    pub license_comments: Vec<&'static [u8]>, // TODO(port): lifetime — arena
    pub options: ParserOptions<'static>,      // TODO(port): lifetime
    // Zig: `tailwind: if (AtRule == BundlerAtRule) ?*BundlerTailwindState else u0`
    // TODO(port): conditional field; for now Option<Box<_>> always.
    pub tailwind: Option<Box<BundlerTailwindState>>,
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
            tailwind: None,
            layer_names: Vec::new(),
            local_scope: LocalScope::default(),
            local_properties: LocalPropertyUsage::default(),
            composes: ComposesMap::default(),
        }
    }
}

// ── StyleSheet behavior (parse/minify/to_css) ────────────────────────────────
// B-2 round 6: un-gated. Method *signatures* are real so cross-crate dependents
// (`bun_css_jsc::testing_impl`) type-check; method *bodies* are ported with
// `// PORT NOTE:` borrowck reshapes where Zig aliased pointers.
mod stylesheet_impl {
    use super::*;

    impl<AtRule> StyleSheet<AtRule> {
        /// Minify and transform the style sheet for the provided browser targets.
        ///
        /// PORT NOTE: `arena` is the arena that owns this stylesheet's AST
        /// (Zig: `arena: Allocator`). It is threaded into `MinifyContext` so
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
            let ctx = PropertyHandlerContext::new(arena, options.targets, &options.unused_symbols);
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
            };

            if self.rules.minify(&mut minify_ctx, false).is_err() {
                panic!("TODO: Handle");
            }

            Ok(())
        }

        pub fn to_css_with_writer<'a>(
            &'a self,
            arena: &'a Bump,
            writer: &'a mut dyn bun_io::Write,
            options: PrinterOptions<'a>,
            import_info: Option<ImportInfo<'a>>,
            local_names: Option<&'a LocalsResultsMap>,
            symbols: &'a bun_ast::symbol::Map,
        ) -> PrintResult<ToCssResultInternal> {
            // PORT NOTE: PrinterOptions has `&mut SourceMap` and so isn't Copy; capture
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

        pub fn to_css_with_writer_impl<'a>(
            &'a self,
            printer: &mut Printer<'a>,
            project_root: Option<&[u8]>,
        ) -> Result<ToCssResultInternal, PrintErr> {
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
                // SAFETY: `'bump`-erasure — `Printer<'a>` stores `CssModule<'a>` which
                // holds `&'a mut CssModuleReferences<'a>`; tying the borrow to `'a`
                // (the printer's whole lifetime) makes the local `references`
                // unmovable. Detach the borrow here and re-attach by clearing
                // `printer.css_module` before moving `references` out below.
                // Re-thread once `Printer<'a>` / `CssModule<'a>` split borrow vs.
                // arena lifetimes (see rules/mod.rs `decl_block_static`).
                let references_mut: &mut CssModuleReferences<'_> =
                    unsafe { &mut *(&raw mut references) };
                printer.css_module = Some(CssModule::new(
                    printer.arena,
                    config,
                    &self.sources,
                    project_root,
                    references_mut,
                ));

                self.rules.to_css(printer)?;
                printer.newline()?;

                let dependencies = printer.dependencies.take().map(|v| v.into_iter().collect());
                let exports = core::mem::take(
                    &mut printer.css_module.as_mut().unwrap().exports_by_source_index[0],
                );
                // Release the `&mut references` borrow held by `CssModule` before
                // moving `references` into the result.
                printer.css_module = None;

                // SAFETY: `'bump`-erasure — `ToCssResultInternal` carries `'static`
                // placeholders for `CssModuleExports`/`References` until the arena
                // lifetime threads (see field TODO at the struct def).
                return Ok(ToCssResultInternal {
                    dependencies,
                    exports: Some(unsafe {
                        core::mem::transmute::<CssModuleExports<'_>, CssModuleExports<'static>>(
                            exports,
                        )
                    }),
                    references: Some(unsafe {
                        core::mem::transmute::<CssModuleReferences<'_>, CssModuleReferences<'static>>(
                            references,
                        )
                    }),
                });
            } else {
                self.rules.to_css(printer)?;
                printer.newline()?;
                return Ok(ToCssResultInternal {
                    dependencies: printer.dependencies.take().map(|v| v.into_iter().collect()),
                    exports: None,
                    references: None,
                });
            }
        }

        pub fn to_css<'a>(
            &'a self,
            arena: &'a Bump,
            options: PrinterOptions<'a>,
            import_info: Option<ImportInfo<'a>>,
            local_names: Option<&'a LocalsResultsMap>,
            symbols: &'a bun_ast::symbol::Map,
        ) -> PrintResult<ToCssResult> {
            // TODO: this is not necessary
            // Make sure we always have capacity > 0: https://github.com/napi-rs/napi-rs/issues/1124.
            // TODO(port): writer adapter — Zig used std.Io.Writer.Allocating; here we
            // route through bun_io::Write over Vec<u8> until 'bump dest threads.
            // blocked_on: bun_io::Write impl for Vec<u8> / dest ownership reshape.
            let mut dest: Vec<u8> = Vec::with_capacity(1);
            let result = self.to_css_with_writer(
                arena,
                &mut dest,
                options,
                import_info,
                local_names,
                symbols,
            )?;
            return Ok(ToCssResult {
                code: dest,
                dependencies: result.dependencies,
                exports: result.exports,
                references: result.references,
            });
        }

        pub fn parse(
            arena: &'static Bump,
            code: &[u8],
            options: ParserOptions<'static>,
            import_records: Option<&mut Vec<ImportRecord>>,
            source_index: SrcIndex,
        ) -> Maybe<(StyleSheet<DefaultAtRule>, StylesheetExtra), Err<ParserError>> {
            // PORT NOTE: Zig instantiated `StyleSheet(DefaultAtRule).parse`; Rust
            // cannot vary `Self`'s `AtRule` param against `DefaultAtRuleParser`, so
            // this returns the concrete `StyleSheet<DefaultAtRule>`. Callers that
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
        // TODO(port): `ParserOptions<'static>` matches the `StyleSheet.options`
        // field's `'static` erasure; re-threads to `<'bump>` alongside the rest of
        // the crate.
        pub fn parse_with<P: CustomAtRuleParser<AtRule = AtRule>>(
            arena: &'static Bump,
            code: &[u8],
            options: ParserOptions<'static>,
            at_rule_parser: &mut P,
            import_records: Option<core::ptr::NonNull<Vec<ImportRecord>>>,
            source_index: SrcIndex,
        ) -> Maybe<(Self, StylesheetExtra), Err<ParserError>> {
            // TODO(port): 'bump lifetime threading — every arena-backed slice the
            // parser hands back is currently detached to `'static` (matching the
            // crate-wide erasure on `DeclarationBlock<'static>`/`Token` payloads).
            // The caller owns the arena (matching Zig's `arena: Allocator`
            // parameter) so the storage outlives the returned `StyleSheet`; Phase B
            // re-threads the lifetime through `CssRuleList<'bump, R>` and drops the
            // `'static` bound on `arena`.
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

            // PERF(port): was arena bulk-free — profile in Phase B
            let mut license_comments: Vec<&'static [u8]> = Vec::new();
            let mut state = parser.state();
            while let Ok(token) = parser.next_including_whitespace_and_comments() {
                match *token {
                    Token::Whitespace(_) => {}
                    Token::Comment(comment) => {
                        if comment.first() == Some(&b'!') {
                            // TODO(port): lifetime — arena slice; see erasure note.
                            license_comments.push(unsafe { &*std::ptr::from_ref::<[u8]>(comment) });
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

            let mut sources: Vec<Box<[u8]>> = Vec::with_capacity(1);
            sources.push(Box::<[u8]>::from(options.filename));
            let mut source_map_urls: Vec<Option<Box<[u8]>>> = Vec::with_capacity(1);
            source_map_urls.push(parser.current_source_map_url().map(Box::<[u8]>::from));

            // Spec: `.layer_names = if (comptime P == BundlerAtRuleParser)
            // at_rule_parser.layer_names else .{}` (css_parser.zig:3324). Rust
            // dispatches through the `CustomAtRuleParser::take_layer_names` hook
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
                    tailwind: None,
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
            let _ = actual_layer_rules_len;
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
                layer_names: Vec::new(),
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
            &mut self,
            out: &mut CssRuleList<AtRule>,
            new_import_records: &mut Vec<ImportRecord>,
        ) {
            // PORT NOTE: the Zig fn takes `*const @This()` but writes
            // `rule.* = .ignored;` through it (Zig has no const-transitivity).
            // Writing through a `*const`-derived pointer is UB in Rust, so the
            // receiver is reshaped to `&mut self`. The sole caller (Tailwind
            // bundling) owns the stylesheet exclusively at this point.
            //
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
            // PERF(port): was ensureUnusedCapacity — profile in Phase B
            let mut saw_imports = false;
            for rule in self.rules.v.iter_mut() {
                match rule {
                    // TODO: layer, might have imports
                    CssRule::LayerBlock(_) => {}
                    CssRule::Import(import_rule) => {
                        if !saw_imports {
                            saw_imports = true;
                        }
                        let import_record_idx = u32::try_from(new_import_records.len()).unwrap();
                        import_rule.import_record_idx = import_record_idx;
                        new_import_records.push(ImportRecord {
                            path: ast::fs::path_init(import_rule.url),
                            kind: if import_rule.supports.is_some() {
                                ImportKind::AtConditional
                            } else {
                                ImportKind::At
                            },
                            range: bun_ast::Range::NONE,
                            // NOTE: `ImportRecord` deliberately has no `Default`; spell out
                            // remaining fields explicitly (matches on_import_rule above).
                            tag: Default::default(),
                            loader: None,
                            source_index: Default::default(),
                            module_id: 0,
                            original_path: b"",
                            flags: Default::default(),
                        });
                        // PORT NOTE: reshaped for borrowck — Zig did
                        // `out.v.appendAssumeCapacity(rule.*)` (bitwise copy) then
                        // `rule.* = .ignored`. Rust moves the rule out via
                        // `mem::replace` (no `Clone` bound needed) and pushes that.
                        let old = core::mem::replace(rule, CssRule::Ignored);
                        // PERF(port): was appendAssumeCapacity
                        out.v.push(old);
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

    impl StyleAttribute {
        pub fn parse(
            arena: &'static Bump,
            code: &[u8],
            options: ParserOptions,
            import_records: &mut Vec<ImportRecord>,
            source_index: SrcIndex,
        ) -> Maybe<StyleAttribute, Err<ParserError>> {
            // TODO(port): 'bump lifetime threading — `DeclarationBlock<'static>` in
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
            let mut sources: Vec<Box<[u8]>> = Vec::with_capacity(1);
            // PERF(port): was appendAssumeCapacity
            sources.push(options.filename.into());
            Ok(StyleAttribute {
                declarations: match DeclarationBlock::parse(&mut parser, &options) {
                    Ok(v) => v,
                    Err(e) => return Err(Err::from_parse_error(e, b"")),
                },
                sources,
            })
        }

        pub fn to_css<'a>(
            &'a self,
            arena: &'a Bump,
            options: PrinterOptions<'a>,
            import_info: Option<ImportInfo<'a>>,
        ) -> Result<ToCssResult, PrintErr> {
            // #[cfg(feature = "sourcemap")]
            // assert!(
            //   options.source_map.is_none(),
            //   "Source maps are not supported for style attributes"
            // );

            let symbols = bun_ast::symbol::Map::init_list(Default::default());
            // TODO(port): writer adapter — Zig used std.Io.Writer.Allocating; route
            // through bun_io::Write over Vec<u8> until 'bump dest threads.
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

            let dependencies = printer.dependencies.take().map(|v| v.into_iter().collect());
            drop(printer);
            Ok(ToCssResult {
                dependencies,
                code: dest,
                exports: None,
                references: None,
            })
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
            // PORT NOTE: Zig aliased `import_records` into both `BundlerAtRuleParser`
            // *and* the inner `Parser` (css_parser.zig:3245), and aliased `&options`
            // into the at-rule parser while also passing `options` by value (struct
            // copy) to `parseWith`. Rust forbids both overlaps directly:
            // - `import_records`: derive a single raw `NonNull` from the unique
            //   borrow; both the at-rule parser and `Parser::new` store copies of
            //   that raw pointer (matching Zig's `?*Vec`). Neither holds a
            //   long-lived `&mut`, so interleaved writes from `on_import_rule` and
            //   `add_import_record`/`state`/`reset` each create a fresh short-lived
            //   `&mut` from the shared SharedRW provenance — sound under SB.
            // - `options`: bitwise-duplicate via `ptr::read` (mirroring Zig's
            //   by-value struct copy) and wrap the original in `ManuallyDrop` so
            //   only the moved copy drops — `ParserOptions` transitively owns a
            //   `SmallList` (via `css_modules::Config::pattern`) which has a real
            //   `Drop`, so both copies must not run their destructors.
            let options = core::mem::ManuallyDrop::new(options);
            // SAFETY: original is `ManuallyDrop`; only `options_for_parse` drops.
            let options_for_parse = unsafe { core::ptr::read(&raw const *options) };
            let import_records_ptr = core::ptr::NonNull::from(import_records);
            let mut at_rule_parser = BundlerAtRuleParser {
                arena,
                import_records: import_records_ptr.as_ptr(),
                options: &options,
                layer_names: Vec::new(),
                anon_layer_count: 0,
                enclosing_layer: LayerName::default(),
            };
            Self::parse_with(
                arena,
                code,
                options_for_parse,
                &mut at_rule_parser,
                Some(import_records_ptr),
                source_index,
            )
        }
    }
} // mod stylesheet_impl

// ───────────────────────────── StyleAttribute ─────────────────────────────

pub struct StyleAttribute {
    // PORT NOTE: `DeclarationBlock<'bump>` borrows the parser arena; lifetime
    // erased to `'static` until 'bump threads through the rule tree (matches
    // `StyleRule.declarations` in rules/style.rs).
    pub declarations: DeclarationBlock<'static>,
    pub sources: Vec<Box<[u8]>>,
}

impl StyleAttribute {
    pub fn minify(&mut self, _options: MinifyOptions) {
        // TODO: IMPLEMENT THIS!
    }
}

// ───────────────────────────── RuleBodyParser ─────────────────────────────
//
// B-2 round 5: un-gated. `RuleBodyItemParser`/`DeclarationParser` traits are
// hoisted above; this is pure trait-generic over `P`.

pub struct RuleBodyParser<'i, 't, P: RuleBodyItemParser> {
    pub input: &'i mut Parser<'t>,
    pub parser: &'i mut P,
}

impl<'i, 't, P> RuleBodyParser<'i, 't, P>
where
    P: RuleBodyItemParser<
            Declaration = <P as QualifiedRuleParser>::QualifiedRule,
            AtRule = <P as QualifiedRuleParser>::QualifiedRule,
        >,
{
    pub fn new(input: &'i mut Parser<'t>, parser: &'i mut P) -> Self {
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
                let start_clone = start.clone();
                self.input
                    .parse_until_after(Delimiters::SEMICOLON, move |_i| {
                        Err(start_clone
                            .source_location()
                            .new_unexpected_token_error(token))
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
    ///
    /// Stored as a raw `NonNull<Log>` (mirrors Zig's `*Log`) so `warn(&self)`
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
    pub fn warn(&self, warning: ParseError<ParserError>) {
        if let Some(lg) = self.logger {
            // SAFETY: `logger` was constructed from a unique `&'a mut Log` (see
            // `default`); the pointee outlives `'a` and no other borrow of the
            // Log exists for the duration of parsing. Zig mutated through `*Log`.
            let lg: &mut Log = unsafe { &mut *lg.as_ptr() };
            lg.add_warning_fmt_line_col(
                self.filename,
                warning.location.line,
                warning.location.column,
                format_args!("{}", warning.kind),
            );
        }
    }

    pub fn warn_fmt(&self, args: fmt::Arguments<'_>, line: u32, column: u32) {
        if let Some(lg) = self.logger {
            // SAFETY: see `warn` — `logger` carries `*mut Log` provenance from a
            // unique `&'a mut Log`; no other borrow exists during this call.
            let lg: &mut Log = unsafe { &mut *lg.as_ptr() };
            lg.add_warning_fmt_line_col(self.filename, line, column, args);
        }
    }

    pub fn warn_fmt_with_notes(
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

    pub fn warn_fmt_with_note(
        &self,
        args: fmt::Arguments<'_>,
        line: u32,
        column: u32,
        note_args: fmt::Arguments<'_>,
        note_range: bun_ast::Range,
    ) {
        if let Some(lg) = self.logger {
            // SAFETY: see `warn`.
            let lg: &mut Log = unsafe { &mut *lg.as_ptr() };
            lg.add_range_warning_fmt_with_note(
                None,
                bun_ast::Range {
                    loc: bun_ast::Loc {
                        start: i32::try_from(line).expect("int cast"),
                    },
                    len: i32::try_from(column).expect("int cast"),
                },
                args,
                note_args,
                note_range,
            );
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
    /// Stored as a raw `NonNull` (mirrors Zig's `?*Vec(ImportRecord)`,
    /// css_parser.zig:3808) because `BundlerAtRuleParser` holds an aliasing
    /// raw pointer to the same list. Keeping a long-lived `&'a mut` here would
    /// be invalidated under Stacked Borrows the moment `on_import_rule`
    /// derives its own `&mut` from the sibling raw pointer. Each access site
    /// materialises a fresh short-lived `&mut` instead.
    pub import_records: Option<core::ptr::NonNull<Vec<ImportRecord>>>,
    pub extra: Option<&'a mut ParserExtra>,
}

impl<'a> Parser<'a> {
    pub fn add_symbol_for_name(
        &mut self,
        name: &[u8],
        tag: CssRefTag,
        loc: bun_ast::Loc,
    ) -> bun_ast::Ref {
        // don't call this if css modules is not enabled!
        debug_assert!(self.flags.css_modules());
        debug_assert!(self.extra.is_some());
        if cfg!(debug_assertions) {
            // tag should only have one bit set, or none
            debug_assert!(tag.bits().count_ones() <= 1);
        }

        let extra = self.extra.as_deref_mut().unwrap();
        // Split borrows so the vacant arm can grow `symbols` while
        // `local_scope` is borrowed by the entry.
        let symbols = &mut extra.symbols;
        let local_scope = &mut extra.local_scope;
        let source_index = extra.source_index.get();

        // SAFETY: `name` is a slice into the parser source / arena, both of
        // which outlive the symbol table (`ParserExtra` is consumed into
        // `StylesheetExtra` alongside the same arena). Detach the borrow so it
        // satisfies `Symbol.original_name: &'static [u8]` (Phase-A lifetime
        // erasure — see PORTING.md §Lifetimes).
        let name_static: &'static [u8] = unsafe { &*std::ptr::from_ref::<[u8]>(name) };

        let entry = match local_scope.entry(Box::<[u8]>::from(name)) {
            MapEntry::Vacant(v) => {
                let inner_index = u32::try_from(symbols.len()).unwrap();
                symbols.push(bun_ast::Symbol {
                    kind: bun_ast::SymbolKind::LocalCss,
                    original_name: name_static.into(),
                    ..Default::default()
                });
                v.insert(LocalEntry {
                    ref_: CssRef::new(inner_index, tag),
                    loc,
                })
            }
            MapEntry::Occupied(o) => {
                let e = o.into_mut();
                let prev_tag = e.ref_.tag();
                if !prev_tag.contains(CssRefTag::CLASS) && tag.contains(CssRefTag::CLASS) {
                    e.loc = loc;
                    e.ref_.set_tag(prev_tag | tag);
                }
                e
            }
        };

        entry.ref_.to_real_ref(source_index)
    }

    // TODO: dedupe import records??
    pub fn add_import_record(
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
            // every `ImportRecord` produced by this parse. `bun.fs.Path` in
            // the Zig original stores the same borrowed slice; Phase-A
            // erases the lifetime to 'static (see PORTING.md §Lifetimes).
            let url_static: &'static [u8] = unsafe { &*std::ptr::from_ref::<[u8]>(url) };
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
                module_id: 0,
                original_path: b"",
                flags: Default::default(),
            });
            Ok(idx)
        } else {
            // SAFETY: same lifetime erasure as above; the error token is only
            // used for diagnostics borrowing the same source.
            let url_static: &'static [u8] = unsafe { &*std::ptr::from_ref::<[u8]>(url) };
            Err(self.new_basic_unexpected_token_error(Token::UnquotedUrl(url_static)))
        }
    }

    #[inline]
    pub fn arena(&self) -> &Bump {
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

    pub fn new_custom_error(&self, err: ParserError) -> ParseError<ParserError> {
        self.current_source_location().new_custom_error(err)
    }

    pub fn new_basic_error(&self, kind: BasicParseErrorKind) -> BasicParseError {
        BasicParseError {
            kind,
            location: self.current_source_location(),
        }
    }

    pub fn new_error(&self, kind: BasicParseErrorKind) -> ParseError<ParserError> {
        ParseError {
            kind: errors_::ParserErrorKind::basic(kind),
            location: self.current_source_location(),
        }
    }

    pub fn new_unexpected_token_error(&self, token: Token) -> ParseError<ParserError> {
        self.new_error(BasicParseErrorKind::unexpected_token(token))
    }

    pub fn new_basic_unexpected_token_error(&self, token: Token) -> ParseError<ParserError> {
        self.new_basic_error(BasicParseErrorKind::unexpected_token(token))
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
    pub fn try_parse<R>(&mut self, func: impl FnOnce(&mut Parser) -> CssResult<R>) -> CssResult<R> {
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
            if strings::eql_case_insensitive_asciii_check_length(name, i) {
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
            if strings::eql_case_insensitive_asciii_check_length(name, fn_name) {
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
    pub fn expect_url_or_string(&mut self) -> CssResult<&[u8]> {
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
    pub fn expect_ident_cloned(&mut self) -> CssResult<&'static [u8]> {
        let s = self.expect_ident()?;
        // SAFETY: `s` is a sub-slice of `self.input.tokenizer.src` (`&'a [u8]`)
        // or arena-owned; the returned reference is only ever stored in
        // structures reachable through the same `Parser<'a>`. See `src_str`.
        Ok(unsafe { src_str(s) })
    }

    /// `expect_function` with the borrow detached. See [`expect_ident_cloned`].
    #[inline]
    pub fn expect_function_cloned(&mut self) -> CssResult<&'static [u8]> {
        let s = self.expect_function()?;
        // SAFETY: see `expect_ident_cloned`.
        Ok(unsafe { src_str(s) })
    }

    /// `expect_string` with the borrow detached. See [`expect_ident_cloned`].
    #[inline]
    pub fn expect_string_cloned(&mut self) -> CssResult<&'static [u8]> {
        let s = self.expect_string()?;
        // SAFETY: see `expect_ident_cloned`.
        Ok(unsafe { src_str(s) })
    }

    /// `expect_ident_or_string` with the borrow detached. See [`expect_ident_cloned`].
    #[inline]
    pub fn expect_ident_or_string_cloned(&mut self) -> CssResult<&'static [u8]> {
        let s = self.expect_ident_or_string()?;
        // SAFETY: see `expect_ident_cloned`.
        Ok(unsafe { src_str(s) })
    }

    /// `expect_url` with the borrow detached. See [`expect_ident_cloned`].
    #[inline]
    pub fn expect_url_cloned(&mut self) -> CssResult<&'static [u8]> {
        let s = self.expect_url()?;
        // SAFETY: see `expect_ident_cloned`.
        Ok(unsafe { src_str(s) })
    }

    /// `slice_from` with the borrow detached. See [`expect_ident_cloned`].
    #[inline]
    pub fn slice_from_cloned(&self, start_position: usize) -> &'static [u8] {
        // SAFETY: see `expect_ident_cloned`.
        unsafe { src_str(self.slice_from(start_position)) }
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
        if self.stop_before.intersects(Delimiters::from_byte(byte)) {
            return None;
        }
        byte
    }

    pub fn reset(&mut self, state_: &ParserState) {
        self.input.tokenizer.reset(state_);
        self.at_start_of = state_.at_start_of;
        if let Some(ptr) = self.import_records {
            // Roll back any speculatively-added @import/url() records.
            // SAFETY: see `Parser.import_records` field doc.
            unsafe { &mut *ptr.as_ptr() }
                .shrink_retaining_capacity(state_.import_record_count as usize);
        }
    }

    pub fn state(&self) -> ParserState {
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
    pub fn next_including_whitespace_and_comments(&mut self) -> CssResult<&Token> {
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
    pub fn new_error_for_next_token(&mut self) -> ParseError<ParserError> {
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
    /// Create a `ParserInput` borrowing `code` and an arena for unescaped
    /// strings. Matches Zig `ParserInput.new` (css_parser.zig:4549) which
    /// takes an `Allocator` parameter — the caller owns the arena and it must
    /// outlive every `Token` produced from this input.
    ///
    /// PORTING.md §Forbidden: do not fabricate `&'a Bump` from a boxed field
    /// via raw-pointer cast; the previous self-referential `owned_arena` hack
    /// was removed. Callers now pass `&'a Bump` explicitly.
    pub fn new(code: &'a [u8], arena: &'a Bump) -> ParserInput<'a> {
        ParserInput {
            tokenizer: Tokenizer::init_with_arena(code, arena),
            cached_token: None,
        }
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
            column: u32::try_from(self.position - self.current_line_start_position + 1)
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
    pub arena: &'a Bump,
    var_or_env_functions: SeenStatus,
    pub current: Token,
    pub previous: Token,
}

const FORM_FEED_BYTE: u8 = 0x0C;
const REPLACEMENT_CHAR: u32 = 0xFFFD;
const REPLACEMENT_CHAR_UNICODE: [u8; 3] = [0xEF, 0xBF, 0xBD];
/// UTF-8 encoding of U+0FFD — used by `serializer` where Zig called
/// `bun.strings.encodeUTF8Comptime(0xFFD)` (css_parser.zig:6747, :6937). The
/// Zig literal is `0xFFD` (sic — likely a typo for `0xFFFD`), but the spec is
/// ground truth: encode 0x0FFD → [0xE0, 0xBF, 0xBD] to byte-match. Phase B
/// should confirm whether the spec itself needs fixing to 0xFFFD.
// TODO(port): verify upstream — Zig wrote 0xFFD, comment says "replacement
// character" which is U+FFFD. Byte-matching the spec (0x0FFD) for now.
const REPLACEMENT_CHAR_UTF8: &[u8] = &[0xE0, 0xBF, 0xBD];
const MAX_ONE_B: u32 = 0x80;
const MAX_TWO_B: u32 = 0x800;
const MAX_THREE_B: u32 = 0x10000;

/// Erase a source-slice borrow to `'static` for storing in `Token` payloads.
///
/// PORTING.md §Forbidden flags this erasure. The proper fix is to thread a
/// real `'a` lifetime through `Token<'a>` / `Dimension<'a>` / `CachedToken<'a>`
/// so `slice_from`/`to_slice` return `&'a [u8]` (matching Zig's plain
/// `[]const u8` borrows in css_parser.zig:5879/6461). That change is blocked
/// on `crate::Token` (defined in `lib.rs`, not this file) gaining `<'a>` —
/// once `lib.rs` is updated, delete this fn and every call site compiles with
/// the honest lifetime.
// TODO(port): delete once `Token<'a>` lands in lib.rs; see verifier bug
// "src_str / Tokenizer::slice_from / CopyOnWriteStr::to_slice".
// SAFETY: every call site below feeds either (a) a sub-slice of `self.src`
// (`&'a [u8]`) or (b) an arena-allocated `CopyOnWriteStr::to_slice()` whose
// backing storage lives in `self.arena: &'a Bump`. The returned reference
// is only ever stored in a `Token` reachable through that same `Parser<'a>`.
#[inline(always)]
pub unsafe fn src_str(s: &[u8]) -> &'static [u8] {
    unsafe { bun_collections::detach_lifetime(s) }
}

impl<'a> Tokenizer<'a> {
    pub fn init_with_arena(src: &'a [u8], arena: &'a Bump) -> Tokenizer<'a> {
        Tokenizer {
            src,
            position: 0,
            source_map_url: None,
            current_line_start_position: 0,
            current_line_number: 0,
            arena,
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
            column: u32::try_from((self.position - self.current_line_start_position) + 1)
                .expect("int cast"),
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
            if strings::eql_case_insensitive_ascii_check_length(name, b"var")
                && strings::eql_case_insensitive_ascii_check_length(name, b"env")
            {
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
                if (self.has_at_least(1) && matches!(self.byte_at(1), b'0'..=b'9'))
                    || (self.has_at_least(2)
                        && self.byte_at(1) == b'.'
                        && matches!(self.byte_at(2), b'0'..=b'9'))
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
                    Token::Delim(u32::from(b'-'))
                }
            }
            b'.' => {
                if self.has_at_least(1) && matches!(self.byte_at(1), b'0'..=b'9') {
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

    pub fn consume_name(&mut self) -> &'static [u8] {
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

    pub fn consume_quoted_string<const SINGLE_QUOTE: bool>(&mut self) -> (&'static [u8], bool) {
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

    pub fn consume_url_end(&mut self, start_pos: usize, string: CopyOnWriteStr<'a>) -> Token {
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
        // TODO(port): Zig used std.unicode.utf8Encode; route through char's
        // UTF-8 encoder (val is guaranteed a valid scalar by consume_escape).
        let c = char::from_u32(val).unwrap_or('\u{FFFD}');
        let len = c.encode_utf8(&mut utf8bytes).len();
        bytes.append(self.arena, &utf8bytes[..len]);
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

    pub fn consume_hex_digits(&mut self) -> (u32, u32) {
        let (value, n) = bun_core::fmt::parse_hex_prefix(&self.src[self.position..], 6);
        self.advance(n);
        (value, n as u32)
    }

    pub fn consume_char(&mut self) -> u32 {
        let c = self.next_char();
        let len_utf8 = len_utf8(c);
        self.position += len_utf8;
        // Note that due to the special case for the 4-byte sequence intro,
        // we must use wrapping add here.
        self.current_line_start_position = self
            .current_line_start_position
            .wrapping_add(len_utf8 - len_utf16(c));
        c
    }

    pub fn consume_comment(&mut self) -> &'static [u8] {
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
        let mut p = [0u8; 4];
        let avail = (self.src.len() - self.position).min(4);
        p[..avail].copy_from_slice(&self.src[self.position..self.position + avail]);
        strings::decode_wtf8_rune_t::<u32>(&p, len, strings::UNICODE_REPLACEMENT as u32)
    }

    #[inline]
    pub fn next_byte_unchecked(&self) -> u8 {
        self.src[self.position]
    }

    #[inline]
    pub fn slice_from(&self, start: usize) -> &'static [u8] {
        // SAFETY: see `src_str` — slice borrows `self.src: &'a [u8]` which the
        // returned `Token` never outlives. `'static` is the Phase-A
        // placeholder for the not-yet-threaded `'bump`/`'input` lifetime.
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

// Data layout hoisted at crate root (lib.rs) so error.rs can name `Token`
// without the parser hub. Behavior impls (kind/is_parse_error/to_css_generic)
// live here. TODO: make strings be allocated in string pool.
// TODO(port): lifetime — every &[u8] payload borrows the arena/source. Phase
// A uses `&'static [u8]` placeholder; Phase B threads `<'a>`.
pub use crate::Token;

impl Token {
    // blocked_on: generics::CssEql/CssHash blanket impls for Token payload set
    pub fn eql(lhs: &Token, rhs: &Token) -> bool {
        // TODO(port): Zig used implementEql (comptime field-walk).
        // Phase B: derive PartialEq once payload lifetimes settle.
        generic::implement_eql(lhs, rhs)
    }

    // blocked_on: generics::CssHash
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

    pub fn to_css_generic<W: WriteAll + ?Sized>(&self, writer: &mut W) -> bun_io::Result<()> {
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

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
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
// for error messages. The full Zig `Token.format` (CSS-serialization-correct)
// is `Token::to_css_generic` above; switch lib.rs's impl to delegate once
// dependents stop relying on the simple form.
// TODO(port): Zig `format` had subtle differences from `to_css_generic`
// (quoted_string→serialize_string, idhash→serialize_identifier). Phase B
// specializes.

/// Byte-writer trait for `serializer` and `to_css_generic` (replaces Zig
/// `anytype` writer). Aliased to the canonical `bun_io::Write`; the associated
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
    pub fn hash(&self, hasher: &mut bun_wyhash::Wyhash) {
        generic::implement_hash(self, hasher)
    }
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
    Owned(bun_alloc::ArenaVec<'a, u8>),
}

impl<'a> CopyOnWriteStr<'a> {
    pub fn append(&mut self, arena: &'a Bump, slice: &[u8]) {
        match self {
            CopyOnWriteStr::Borrowed(b) => {
                let mut list = bun_alloc::ArenaVec::with_capacity_in(b.len() + slice.len(), arena);
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

    pub fn to_slice(self) -> &'static [u8] {
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
    use super::*;

    /// The opaque alpha value of 1.0.
    pub const OPAQUE: f32 = 1.0;

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
    pub fn from_hex(c: u8) -> Result<u8, ColorError> {
        bun_core::fmt::hex_digit_value(c).ok_or(ColorError::Parse)
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
    pub fn serialize_name<W: WriteAll + ?Sized>(
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
    pub fn serialize_string<W: WriteAll + ?Sized>(
        value: &[u8],
        writer: &mut W,
    ) -> bun_io::Result<()> {
        writer.write_all(b"\"")?;
        let mut sw = CssStringWriter::new(writer);
        sw.write_str(value)?;
        writer.write_all(b"\"")
    }

    pub fn serialize_dimension(
        value: f32,
        unit: &'static [u8],
        dest: &mut Printer,
    ) -> Result<(), PrintErr> {
        let int_value: Option<i32> = if fract(value) == 0.0 {
            Some(value as i32) // saturating like Zig bun.intFromFloat
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
    pub fn serialize_identifier<W: WriteAll + ?Sized>(
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

    pub fn serialize_unquoted_url<W: WriteAll + ?Sized>(
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

    pub fn write_numeric<W: WriteAll + ?Sized>(
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

    pub fn hex_escape<W: WriteAll + ?Sized>(ascii_byte: u8, writer: &mut W) -> bun_io::Result<()> {
        let mut bytes = [0u8; 4];
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

    pub fn char_escape<W: WriteAll + ?Sized>(ascii_byte: u8, writer: &mut W) -> bun_io::Result<()> {
        let bytes = [b'\\', ascii_byte];
        writer.write_all(&bytes)
    }

    pub struct CssStringWriter<'w, W: WriteAll + ?Sized> {
        inner: &'w mut W,
    }

    impl<'w, W: WriteAll + ?Sized> CssStringWriter<'w, W> {
        /// Wrap a text writer to create a `CssStringWriter`.
        pub fn new(inner: &'w mut W) -> Self {
            Self { inner }
        }

        pub fn write_str(&mut self, str: &[u8]) -> bun_io::Result<()> {
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
    pub type FixedBufWriter<'a> = bun_io::FixedBufferStream<&'a mut [u8]>;
}

// ───────────────────────────── misc utilities ─────────────────────────────

pub mod parse_utility {
    use super::*;

    /// Parse a value from a string.
    ///
    /// NOTE: `input` should live as long as the returned value. Otherwise,
    /// strings in the returned parsed value will point to undefined memory.
    pub fn parse_string<T>(
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

pub mod to_css {
    use super::*;

    /// Serialize `self` in CSS syntax and return a string.
    ///
    /// (This is a convenience wrapper for `to_css` and probably should not be overridden.)
    pub fn string<'a, T: generic::ToCss>(
        arena: &'a Bump,
        this: &T,
        options: PrinterOptions<'a>,
        import_info: Option<ImportInfo<'a>>,
        local_names: Option<&'a LocalsResultsMap>,
        symbols: &'a bun_ast::symbol::Map,
    ) -> Result<Vec<u8>, PrintErr> {
        let mut s: Vec<u8> = Vec::new();
        // PERF: think about how cheap this is to create
        let mut printer = Printer::new(
            arena,
            bun_alloc::ArenaVec::new_in(arena),
            &mut s,
            options,
            import_info,
            local_names,
            symbols,
        );
        // PORT NOTE: Zig special-cased `T == CSSString` → `CSSStringFns.toCss`;
        // in Rust the `ToCss` impl on `CSSString` routes there directly, so the
        // generic dispatch suffices.
        this.to_css(&mut printer)?;
        drop(printer);
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

    pub fn integer(this: i32, dest: &mut Printer) -> Result<(), PrintErr> {
        let mut b = bun_core::fmt::ItoaBuf::new();
        dest.write_bytes(bun_core::fmt::itoa(&mut b, this))
    }

    pub fn float32(this: f32, writer: &mut Printer) -> Result<(), PrintErr> {
        let mut scratch = [0u8; 129];
        let (str, _) = dtoa_short(&mut scratch, this, 6);
        writer.write_bytes(str)
    }
}

/// Parse `!important`.
pub fn parse_important(input: &mut Parser) -> CssResult<()> {
    input.expect_delim(b'!')?;
    input.expect_ident_matching(b"important")
}

pub mod signfns {
    /// Spec-faithful port of `css_parser.zig:7086` — note the ±0.0 sign FLIP is
    /// intentional (do NOT "fix" it). Distinct from `f32::signum` and from
    /// `calc::std_math_sign` / `CSSNumberFns::sign`.
    #[inline]
    pub fn sign_f32(x: f32) -> f32 {
        if x == 0.0 {
            return if x.is_sign_negative() { 0.0 } else { -0.0 };
        }
        x.signum()
    }
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
        Notation {
            decimal_point: false,
            scientific: false,
        }
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

// ported from: src/css/css_parser.zig
