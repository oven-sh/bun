//! CSS custom properties / `var()` / `env()` / unparsed token lists.
//!
//! Ported from `src/css/properties/custom.zig`.
use bun_collections::VecExt;
//
// ─── B-2 round 9 status ────────────────────────────────────────────────────
// `TokenList::{parse, parse_into, parse_with_options, to_css, to_css_raw}`,
// `UnresolvedColor::{parse, to_css}`, `Variable::{parse, to_css}`,
// `EnvironmentVariable::{parse, parse_nested, to_css}`,
// `EnvironmentVariableName::{parse, to_css}`, `Function::to_css`,
// `CustomProperty::parse`, `UnparsedProperty::parse` are now real.
//
// A few leaf calls (Url::parse/to_css, CustomIdent::to_css) are still
// ``-gated in *other* files; those bodies are inlined verbatim
// under `mod ext` below so the hub compiles without touching
// `values/{url,ident}.rs`. `DashedIdentReference::{parse_with_options,to_css}`
// are now real and forwarded directly. Remaining internal
// `` gates carry `blocked_on:` notes for the next round
// (ComponentParser un-gate from `values::color::gated_full_impl`;
// `properties::animation` un-gate; `get_fallback` chain).

use crate as css;
use crate::PrintResult;
use crate::Token;
use crate::css_parser::{self, Delimiters, EnumProperty, Parser, ParserOptions, ParserState};
use crate::error::{BasicParseErrorKind, ParseError, ParserError, ParserErrorKind};
use crate::printer::Printer;

use crate::values as css_values;
use css_values::angle::Angle;
use css_values::color::{ColorFallbackKind, CssColor, RGBA};
use css_values::ident::{
    CustomIdent, CustomIdentFns, DashedIdent, DashedIdentReference, Ident, IdentFns,
};
use css_values::length::LengthValue;
use css_values::number::{CSSInteger, CSSIntegerFns, CSSNumberFns};
use css_values::percentage::Percentage;
use css_values::resolution::Resolution;
use css_values::time::Time;
use css_values::url::Url;

use crate::properties::animation::AnimationName;
use crate::rules::supports::SupportsCondition;

use bun_core::strings;
use bun_wyhash::Wyhash;

use crate::generics::{CssEql, CssHash, DeepClone};
use bun_alloc::Arena;

// ─── External-gate shims ───────────────────────────────────────────────────
// `TokenList::{parse,to_css}` bottom out on a handful of leaf fns that still
// carry `` in *other* files (`values/{url,ident}.rs`,
// `css_modules.rs`). Those gates are stale — every dependency they cite now
// exists — but this round's edit scope is `custom.rs` + `css_parser.rs` only.
// To un-gate the TokenList hub without touching those files, the leaf bodies
// are inlined here verbatim. Once `url.rs`/`ident.rs` un-gate, callers below
// can swap back to the canonical methods and this module drops.
mod ext {
    use super::*;
    use crate::dependencies;

    /// Inline of `Url::parse` (gated in `values/url.rs` on
    /// `Parser::add_import_record`, which now exists at css_parser.rs:3228).
    pub(super) fn url_parse(input: &mut Parser) -> Result<Url> {
        let start_pos = input.position();
        let loc = input.current_source_location();
        let url = input.expect_url()?;
        // SAFETY: `url` borrows the parser source/arena which outlives the
        // `add_import_record` call (same lifetime erasure as `src_str`).
        let url: &'static [u8] = unsafe { &*std::ptr::from_ref::<[u8]>(url) };
        let import_record_idx =
            input.add_import_record(url, start_pos, bun_ast::ImportKind::Url)?;
        Ok(Url {
            import_record_idx,
            loc: dependencies::Location::from_source_location(loc),
        })
    }

    /// Inline of `Url::to_css` (gated in `values/url.rs` on `WriteAll for
    /// Vec<u8>`, which this round adds in css_parser.rs).
    pub(super) fn url_to_css(this: &Url, dest: &mut Printer) -> PrintResult<()> {
        let dep: Option<dependencies::UrlDependency> = if dest.dependencies.is_some() {
            // PORT NOTE: reshaped for borrowck — `get_import_records` borrows
            // &mut *dest, so capture arena/filename first.
            let arena = dest.arena;
            // SAFETY: filename borrows the printer arena/options which outlive `dest`.
            let filename: &[u8] = unsafe { &*std::ptr::from_ref::<[u8]>(dest.filename()) };
            let records = dest.get_import_records()?;
            Some(dependencies::UrlDependency::new(
                arena, this, filename, records,
            ))
        } else {
            None
        };

        // If adding dependencies, always write url() with quotes so that the placeholder can
        // be replaced without escaping more easily. Quotes may be removed later during minification.
        if let Some(d) = dep {
            dest.write_str("url(")?;
            // SAFETY: placeholder borrows the printer arena.
            let placeholder = unsafe { crate::arena_str(d.placeholder) };
            dest.serialize_string(placeholder)?;
            dest.write_char(b')')?;

            if let Some(dependencies) = &mut dest.dependencies {
                // PORT NOTE: bun.handleOom dropped — Vec::push aborts on OOM via global arena
                dependencies.push(crate::Dependency::Url(d));
            }

            return Ok(());
        }

        let import_record = dest.import_record(this.import_record_idx)?;
        let is_internal = import_record.tag.is_internal();
        // PORT NOTE: reshaped for borrowck — `get_import_record_url` reborrows
        // &mut *dest, so capture `is_internal` first.
        let url: &'static [u8] = {
            let u = dest.get_import_record_url(this.import_record_idx)?;
            // SAFETY: import-record paths are arena/source-owned and outlive `dest`.
            unsafe { &*std::ptr::from_ref::<[u8]>(u) }
        };

        if dest.minify && !is_internal {
            // PERF(port): was std.Io.Writer.Allocating with dest.arena — using Vec<u8>; profile in Phase B
            let mut buf: Vec<u8> = Vec::new();
            // PERF(alloc) we could use stack fallback here?
            let _ = Token::UnquotedUrl(url).to_css_generic(&mut buf);

            // If the unquoted url is longer than it would be quoted (e.g. `url("...")`)
            // then serialize as a string and choose the shorter version.
            if buf.len() > url.len() + 7 {
                let mut buf2: Vec<u8> = Vec::new();
                // PERF(alloc) we could use stack fallback here?
                let _ = css_parser::serializer::serialize_string(url, &mut buf2);
                if buf2.len() + 5 < buf.len() {
                    dest.write_str("url(")?;
                    dest.write_str(&buf2)?;
                    return dest.write_char(b')');
                }
            }

            dest.write_str(&buf)?;
        } else {
            dest.write_str("url(")?;
            dest.serialize_string(url)?;
            dest.write_char(b')')?;
        }
        Ok(())
    }

    /// Forwarder to `DashedIdentReference::parse_with_options` (now un-gated
    /// in `values/ident.rs`). Honors `options.css_modules.dashed_idents` and
    /// parses the `from <specifier>` suffix when enabled.
    #[inline]
    pub(super) fn dashed_ident_ref_parse(
        input: &mut Parser,
        options: &ParserOptions,
    ) -> Result<DashedIdentReference> {
        DashedIdentReference::parse_with_options(input, options)
    }

    /// Forwarder to `DashedIdentReference::to_css` (now un-gated in
    /// `values/ident.rs`). `CssModule::reference_dashed` is real; the
    /// CSS-Modules `dashed_idents` remapping path (ident.zig:44-52) is wired.
    #[inline]
    pub(super) fn dashed_ident_ref_to_css(
        this: &DashedIdentReference,
        dest: &mut Printer,
    ) -> PrintResult<()> {
        this.to_css(dest)
    }

    /// Inline of `CustomIdent::to_css` (gated in `values/ident.rs` on
    /// `Printer::write_ident`, which now exists at printer.rs:534).
    pub(super) fn custom_ident_to_css(this: &CustomIdent, dest: &mut Printer) -> PrintResult<()> {
        let css_module_custom_idents_enabled = match &dest.css_module {
            Some(m) => m.config.custom_idents,
            None => false,
        };
        // SAFETY: arena-owned slice valid for the printer's `'a` lifetime.
        let v: &'static [u8] = unsafe { crate::arena_str(this.v) };
        dest.write_ident(v, css_module_custom_idents_enabled)
    }
}

// ─── Token protocol impls ──────────────────────────────────────────────────
// `Token` / `Num` / `Dimension` are defined data-only at crate root (lib.rs);
// their `eql`/`hash` bodies in css_parser.rs forward to `generic::implement_*`
// which bound on these traits — provide them here so the cycle closes and
// `#[derive(CssEql/CssHash/DeepClone)]` on `TokenOrValue` resolves the
// `Token(Token)` arm. Hand-written (not derived) because `Token` carries
// `&'static [u8]` payloads (Phase-A arena-lifetime placeholder) and named-field
// variants whose layout lives outside this module's edit scope.
impl CssEql for crate::Num {
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        self.has_sign == other.has_sign
            && self.value == other.value
            && self.int_value == other.int_value
    }
}
impl CssHash for crate::Num {
    #[inline]
    fn hash(&self, hasher: &mut Wyhash) {
        hasher.update(&[self.has_sign as u8]);
        hasher.update(&self.value.to_ne_bytes());
        if let Some(iv) = self.int_value {
            hasher.update(&iv.to_ne_bytes());
        }
    }
}
impl CssEql for crate::Dimension {
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        self.num.eql(&other.num) && strings::eql(self.unit, other.unit)
    }
}
impl CssHash for crate::Dimension {
    #[inline]
    fn hash(&self, hasher: &mut Wyhash) {
        self.num.hash(hasher);
        hasher.update(self.unit);
    }
}
impl CssEql for Token {
    fn eql(&self, other: &Self) -> bool {
        use Token::*;
        match (self, other) {
            (Ident(a), Ident(b))
            | (Function(a), Function(b))
            | (AtKeyword(a), AtKeyword(b))
            | (UnrestrictedHash(a), UnrestrictedHash(b))
            | (IdHash(a), IdHash(b))
            | (QuotedString(a), QuotedString(b))
            | (BadString(a), BadString(b))
            | (UnquotedUrl(a), UnquotedUrl(b))
            | (BadUrl(a), BadUrl(b))
            | (Whitespace(a), Whitespace(b))
            | (Comment(a), Comment(b)) => strings::eql(a, b),
            (Delim(a), Delim(b)) => a == b,
            (Number(a), Number(b)) => a.eql(b),
            (Dimension(a), Dimension(b)) => a.eql(b),
            (
                Percentage {
                    has_sign: a0,
                    unit_value: a1,
                    int_value: a2,
                },
                Percentage {
                    has_sign: b0,
                    unit_value: b1,
                    int_value: b2,
                },
            ) => a0 == b0 && a1 == b1 && a2 == b2,
            (Cdo, Cdo)
            | (Cdc, Cdc)
            | (IncludeMatch, IncludeMatch)
            | (DashMatch, DashMatch)
            | (PrefixMatch, PrefixMatch)
            | (SuffixMatch, SuffixMatch)
            | (SubstringMatch, SubstringMatch)
            | (Colon, Colon)
            | (Semicolon, Semicolon)
            | (Comma, Comma)
            | (OpenSquare, OpenSquare)
            | (CloseSquare, CloseSquare)
            | (OpenParen, OpenParen)
            | (CloseParen, CloseParen)
            | (OpenCurly, OpenCurly)
            | (CloseCurly, CloseCurly) => true,
            _ => false,
        }
    }
}
impl CssHash for Token {
    fn hash(&self, hasher: &mut Wyhash) {
        use Token::*;
        // Zig `implementHash`: tag prefix + payload bytes.
        // `Token::kind() as u32` gives a stable per-variant discriminant.
        hasher.update(&(self.kind() as u32).to_ne_bytes());
        match self {
            Ident(v) | Function(v) | AtKeyword(v) | UnrestrictedHash(v) | IdHash(v)
            | QuotedString(v) | BadString(v) | UnquotedUrl(v) | BadUrl(v) | Whitespace(v)
            | Comment(v) => hasher.update(v),
            Delim(d) => hasher.update(&d.to_ne_bytes()),
            Number(n) => n.hash(hasher),
            Dimension(d) => d.hash(hasher),
            Percentage {
                has_sign,
                unit_value,
                int_value,
            } => {
                hasher.update(&[*has_sign as u8]);
                hasher.update(&unit_value.to_ne_bytes());
                if let Some(iv) = int_value {
                    hasher.update(&iv.to_ne_bytes());
                }
            }
            _ => {}
        }
    }
}
impl<'bump> DeepClone<'bump> for Token {
    #[inline]
    fn deep_clone(&self, _bump: &'bump Arena) -> Self {
        // All `&'static [u8]` payloads borrow the parser source/arena (Phase-A
        // `'static` placeholder) — identity copy is correct (matches generics.zig
        // "const strings" fast-path). `Num`/`Dimension` are POD.
        self.clone()
    }
}

// PERF(port): css is listed as an AST crate (arena-backed) in PORTING.md, but
// LIFETIMES.tsv pre-classified the token vecs here as plain `Vec<TokenOrValue>`.
// Phase A drops arena params and uses global-alloc `Vec`; Phase B may need
// to thread `&'bump Bump` if profiling shows it.

/// Zig: `pub fn Result(comptime T: type) type` → `Maybe(T, ParseError(ParserError))`.
pub use css_parser::CssResult as Result;

/// PERF: nullable optimization
#[derive(Default, CssEql, CssHash, DeepClone)]
pub struct TokenList {
    pub v: Vec<TokenOrValue>,
}

impl TokenList {
    // deinit(): body only freed owned `Vec` fields — handled by `Drop` on `Vec`.

    pub fn to_css(&self, dest: &mut Printer, is_custom_property: bool) -> PrintResult<()> {
        if !dest.minify && self.v.len() == 1 && self.v[0].is_whitespace() {
            return Ok(());
        }

        let mut has_whitespace = false;
        for (i, token_or_value) in self.v.iter().enumerate() {
            match token_or_value {
                TokenOrValue::Color(color) => {
                    color.to_css(dest)?;
                    has_whitespace = false;
                }
                TokenOrValue::UnresolvedColor(color) => {
                    color.to_css(dest, is_custom_property)?;
                    has_whitespace = false;
                }
                TokenOrValue::Url(url) => {
                    if dest.dependencies.is_some()
                        && is_custom_property
                        && !url.is_absolute(dest.get_import_records()?)
                    {
                        let pretty = std::ptr::from_ref::<[u8]>(
                            dest.get_import_records()?
                                .at(url.import_record_idx as usize)
                                .path
                                .pretty,
                        );
                        return dest.new_error(
                            css::PrinterErrorKind::ambiguous_url_in_custom_property { url: pretty },
                            Some(url.loc),
                        );
                    }
                    ext::url_to_css(url, dest)?;
                    has_whitespace = false;
                }
                TokenOrValue::Var(var) => {
                    var.to_css(dest, is_custom_property)?;
                    has_whitespace = self.write_whitespace_if_needed(i, dest)?;
                }
                TokenOrValue::Env(env) => {
                    env.to_css(dest, is_custom_property)?;
                    has_whitespace = self.write_whitespace_if_needed(i, dest)?;
                }
                TokenOrValue::Function(f) => {
                    f.to_css(dest, is_custom_property)?;
                    has_whitespace = self.write_whitespace_if_needed(i, dest)?;
                }
                TokenOrValue::Length(v) => {
                    // Do not serialize unitless zero lengths in custom properties as it may break calc().
                    let (value, unit) = v.to_unit_value();
                    css_parser::serializer::serialize_dimension(value, unit, dest)?;
                    has_whitespace = false;
                }
                TokenOrValue::Angle(v) => {
                    v.to_css(dest)?;
                    has_whitespace = false;
                }
                TokenOrValue::Time(v) => {
                    v.to_css(dest)?;
                    has_whitespace = false;
                }
                TokenOrValue::Resolution(v) => {
                    v.to_css(dest)?;
                    has_whitespace = false;
                }
                TokenOrValue::DashedIdent(v) => {
                    // Inline of `DashedIdent::to_css` (gated in ident.rs on
                    // `Printer::write_dashed_ident`, which now exists).
                    dest.write_dashed_ident(v, true)?;
                    has_whitespace = false;
                }
                TokenOrValue::AnimationName(v) => {
                    v.to_css(dest)?;
                    has_whitespace = false;
                }
                TokenOrValue::Token(token) => match token {
                    Token::Delim(d) => {
                        if *d == b'+' as u32 || *d == b'-' as u32 {
                            dest.write_char(b' ')?;
                            debug_assert!(*d <= 0x7F);
                            dest.write_char(*d as u8)?;
                            dest.write_char(b' ')?;
                        } else {
                            let ws_before =
                                !has_whitespace && (*d == b'/' as u32 || *d == b'*' as u32);
                            debug_assert!(*d <= 0x7F);
                            dest.delim(*d as u8, ws_before)?;
                        }
                        has_whitespace = true;
                    }
                    Token::Comma => {
                        dest.delim(b',', false)?;
                        has_whitespace = true;
                    }
                    Token::CloseParen | Token::CloseSquare | Token::CloseCurly => {
                        token.to_css(dest)?;
                        has_whitespace = self.write_whitespace_if_needed(i, dest)?;
                    }
                    Token::Dimension(dim) => {
                        css_parser::serializer::serialize_dimension(dim.num.value, dim.unit, dest)?;
                        has_whitespace = false;
                    }
                    Token::Number(v) => {
                        CSSNumberFns::to_css(&v.value, dest)?;
                        has_whitespace = false;
                    }
                    _ => {
                        token.to_css(dest)?;
                        has_whitespace = matches!(token, Token::Whitespace(_));
                    }
                },
            }
        }
        Ok(())
    }

    pub fn to_css_raw(&self, dest: &mut Printer) -> PrintResult<()> {
        for token_or_value in self.v.iter() {
            if let TokenOrValue::Token(token) = token_or_value {
                token.to_css(dest)?;
            } else {
                return Err(dest.add_fmt_error());
            }
        }
        Ok(())
    }

    pub fn write_whitespace_if_needed(&self, i: usize, dest: &mut Printer) -> PrintResult<bool> {
        if !dest.minify
            && i != self.v.len() - 1
            && !matches!(
                &self.v[i + 1],
                TokenOrValue::Token(Token::Comma | Token::CloseParen)
            )
        {
            // Whitespace is removed during parsing, so add it back if we aren't minifying.
            dest.write_char(b' ')?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub fn parse(input: &mut Parser, options: &ParserOptions, depth: usize) -> Result<TokenList> {
        let mut tokens: Vec<TokenOrValue> = Vec::new(); // PERF: deinit on error
        TokenListFns::parse_into(input, &mut tokens, options, depth)?;

        // Slice off leading and trailing whitespace if there are at least two tokens.
        // If there is only one token, we must preserve it. e.g. `--foo: ;` is valid.
        // PERF(alloc): this feels like a common codepath, idk how I feel about reallocating a new array just to slice off whitespace.
        if tokens.len() >= 2 {
            let mut start = 0;
            let mut end = tokens.len();
            if tokens[0].is_whitespace() {
                start = 1;
            }
            if tokens[tokens.len() - 1].is_whitespace() {
                end -= 1;
            }
            // PORT NOTE: Zig does `insertSlice(0, slice)` (shallow memcpy) then `tokens.deinit()`
            // (frees only the backing array). `drain` moves the elements out without deep-cloning.
            let newlist: Vec<TokenOrValue> = tokens.drain(start..end).collect();
            return Ok(TokenList { v: newlist });
        }

        Ok(TokenList { v: tokens })
    }

    pub fn parse_with_options(input: &mut Parser, options: &ParserOptions) -> Result<TokenList> {
        Self::parse(input, options, 0)
    }

    pub fn parse_raw(
        input: &mut Parser,
        tokens: &mut Vec<TokenOrValue>,
        options: &ParserOptions,
        depth: usize,
    ) -> Result<()> {
        if depth > 500 {
            return Err(input.new_custom_error(ParserError::maximum_nesting_depth));
        }

        loop {
            let state = input.state();
            let Ok(token) = input.next_including_whitespace() else {
                break;
            };
            match token {
                Token::OpenParen | Token::OpenSquare | Token::OpenCurly => {
                    let tok = token.clone();
                    let closing_delimiter = match tok {
                        Token::OpenParen => Token::CloseParen,
                        Token::OpenSquare => Token::CloseSquare,
                        Token::OpenCurly => Token::CloseCurly,
                        _ => unreachable!(),
                    };
                    tokens.push(TokenOrValue::Token(tok));
                    input.parse_nested_block(|input2| {
                        TokenListFns::parse_raw(input2, tokens, options, depth + 1)
                    })?;
                    tokens.push(TokenOrValue::Token(closing_delimiter));
                }
                Token::Function(_) => {
                    tokens.push(TokenOrValue::Token(token.clone()));
                    input.parse_nested_block(|input2| {
                        TokenListFns::parse_raw(input2, tokens, options, depth + 1)
                    })?;
                    tokens.push(TokenOrValue::Token(Token::CloseParen));
                }
                _ => {
                    if token.is_parse_error() {
                        return Err(ParseError {
                            kind: ParserErrorKind::basic(BasicParseErrorKind::unexpected_token(
                                token.clone(),
                            )),
                            location: state.source_location(),
                        });
                    }
                    tokens.push(TokenOrValue::Token(token.clone()));
                }
            }
        }

        Ok(())
    }

    pub fn parse_into(
        input: &mut Parser,
        tokens: &mut Vec<TokenOrValue>,
        options: &ParserOptions,
        depth: usize,
    ) -> Result<()> {
        if depth > 500 {
            return Err(input.new_custom_error(ParserError::maximum_nesting_depth));
        }

        let mut last_is_delim = false;
        let mut last_is_whitespace = false;

        loop {
            let state = input.state();
            let Ok(tok) = input.next_including_whitespace() else {
                break;
            };
            // PORT NOTE: reshaped for borrowck — clone the token so we can call &mut methods on `input` below.
            let tok = tok.clone();
            match &tok {
                Token::Whitespace(_) | Token::Comment(_) => {
                    // Skip whitespace if the last token was a delimiter.
                    // Otherwise, replace all whitespace and comments with a single space character.
                    if !last_is_delim {
                        tokens.push(TokenOrValue::Token(Token::Whitespace(b" ")));
                        last_is_whitespace = true;
                    }
                    continue;
                }
                Token::Function(f) => {
                    // Attempt to parse embedded color values into hex tokens.
                    if let Some(color) = try_parse_color_token(f, &state, input) {
                        tokens.push(TokenOrValue::Color(color));
                        last_is_delim = false;
                        last_is_whitespace = false;
                    } else if let Ok(color) =
                        input.try_parse(|i| UnresolvedColor::parse(i, f, options, depth))
                    {
                        tokens.push(TokenOrValue::UnresolvedColor(color));
                        last_is_delim = false;
                        last_is_whitespace = false;
                    } else if strings::eql(*f, b"url") {
                        input.reset(&state);
                        tokens.push(TokenOrValue::Url(ext::url_parse(input)?));
                        last_is_delim = false;
                        last_is_whitespace = false;
                    } else if strings::eql(*f, b"var") {
                        let var = input.parse_nested_block(|input2| {
                            let thevar = Variable::parse(input2, options, depth + 1)?;
                            Ok(TokenOrValue::Var(thevar))
                        })?;
                        tokens.push(var);
                        last_is_delim = true;
                        last_is_whitespace = false;
                    } else if strings::eql(*f, b"env") {
                        let env = input.parse_nested_block(|input2| {
                            let env =
                                EnvironmentVariable::parse_nested(input2, options, depth + 1)?;
                            Ok(TokenOrValue::Env(env))
                        })?;
                        tokens.push(env);
                        last_is_delim = true;
                        last_is_whitespace = false;
                    } else {
                        let arguments = input.parse_nested_block(|input2| {
                            TokenListFns::parse(input2, options, depth + 1)
                        })?;
                        tokens.push(TokenOrValue::Function(Function {
                            name: Ident {
                                v: std::ptr::from_ref::<[u8]>(*f),
                            },
                            arguments,
                        }));
                        last_is_delim = true; // Whitespace is not required after any of these chars.
                        last_is_whitespace = false;
                    }
                    continue;
                }
                Token::UnrestrictedHash(h) | Token::IdHash(h) => {
                    'brk: {
                        let Some((r, g, b, a)) = css_parser::color::parse_hash_color(h) else {
                            tokens.push(TokenOrValue::Token(Token::UnrestrictedHash(*h)));
                            break 'brk;
                        };
                        tokens.push(TokenOrValue::Color(CssColor::Rgba(RGBA::from_floats(
                            r as f32 / 255.0,
                            g as f32 / 255.0,
                            b as f32 / 255.0,
                            a,
                        ))));
                    }
                    last_is_delim = false;
                    last_is_whitespace = false;
                    continue;
                }
                Token::UnquotedUrl(_) => {
                    input.reset(&state);
                    tokens.push(TokenOrValue::Url(ext::url_parse(input)?));
                    last_is_delim = false;
                    last_is_whitespace = false;
                    continue;
                }
                Token::Ident(name) => {
                    if name.starts_with(b"--") {
                        tokens.push(TokenOrValue::DashedIdent(DashedIdent {
                            v: std::ptr::from_ref::<[u8]>(*name),
                        }));
                        last_is_delim = false;
                        last_is_whitespace = false;
                        continue;
                    }
                }
                Token::OpenParen | Token::OpenSquare | Token::OpenCurly => {
                    let closing_delimiter = match &tok {
                        Token::OpenParen => Token::CloseParen,
                        Token::OpenSquare => Token::CloseSquare,
                        Token::OpenCurly => Token::CloseCurly,
                        _ => unreachable!(),
                    };
                    tokens.push(TokenOrValue::Token(tok.clone()));
                    input.parse_nested_block(|input2| {
                        TokenListFns::parse_into(input2, tokens, options, depth + 1)
                    })?;
                    tokens.push(TokenOrValue::Token(closing_delimiter));
                    last_is_delim = true; // Whitespace is not required after any of these chars.
                    last_is_whitespace = false;
                    continue;
                }
                Token::Dimension(_) => {
                    let value = if let Ok(length) = LengthValue::try_from_token(&tok) {
                        TokenOrValue::Length(length)
                    } else if let Ok(angle) = Angle::try_from_token(&tok) {
                        TokenOrValue::Angle(angle)
                    } else if let Ok(time) = Time::try_from_token(&tok) {
                        TokenOrValue::Time(time)
                    } else if let Ok(resolution) = Resolution::try_from_token(&tok) {
                        TokenOrValue::Resolution(resolution)
                    } else {
                        TokenOrValue::Token(tok.clone())
                    };

                    tokens.push(value);

                    last_is_delim = false;
                    last_is_whitespace = false;
                    continue;
                }
                _ => {}
            }

            if tok.is_parse_error() {
                return Err(ParseError {
                    kind: ParserErrorKind::basic(BasicParseErrorKind::unexpected_token(tok)),
                    location: state.source_location(),
                });
            }
            last_is_delim = matches!(&tok, Token::Delim(_) | Token::Comma);

            // If this is a delimiter, and the last token was whitespace,
            // replace the whitespace with the delimiter since both are not required.
            if last_is_delim && last_is_whitespace {
                let last = tokens.last_mut().expect("unreachable");
                *last = TokenOrValue::Token(tok);
            } else {
                tokens.push(TokenOrValue::Token(tok));
            }

            last_is_whitespace = false;
        }

        Ok(())
    }

    pub fn get_fallback(&self, bump: &Arena, kind: ColorFallbackKind) -> Self {
        let mut tokens = TokenList::default();
        tokens.v.reserve_exact(self.v.len());
        for old in self.v.iter() {
            let new = match old {
                TokenOrValue::Color(color) => TokenOrValue::Color(color.get_fallback(bump, kind)),
                TokenOrValue::Function(f) => TokenOrValue::Function(f.get_fallback(bump, kind)),
                TokenOrValue::Var(v) => TokenOrValue::Var(v.get_fallback(bump, kind)),
                TokenOrValue::Env(e) => TokenOrValue::Env(e.get_fallback(bump, kind)),
                _ => old.deep_clone(bump),
            };
            tokens.v.push(new);
        }
        tokens
    }

    pub fn get_fallbacks(
        &mut self,
        bump: &Arena,
        targets: css::targets::Targets,
    ) -> css::SmallList<Fallbacks, 2> {
        // Get the full list of possible fallbacks, and remove the lowest one, which will replace
        // the original declaration. The remaining fallbacks need to be added as @supports rules.
        let mut fallbacks = self.get_necessary_fallbacks(targets);
        let lowest_fallback = fallbacks.lowest();
        fallbacks.remove(lowest_fallback);

        let mut res = css::SmallList::<Fallbacks, 2>::default();
        if fallbacks.contains(ColorFallbackKind::P3) {
            // PERF(port): was assume_capacity
            res.append((
                ColorFallbackKind::P3.supports_condition(),
                self.get_fallback(bump, ColorFallbackKind::P3),
            ));
        }

        if fallbacks.contains(ColorFallbackKind::LAB) {
            // PERF(port): was assume_capacity
            res.append((
                ColorFallbackKind::LAB.supports_condition(),
                self.get_fallback(bump, ColorFallbackKind::LAB),
            ));
        }

        if !lowest_fallback.is_empty() {
            for token_or_value in self.v.iter_mut() {
                match token_or_value {
                    TokenOrValue::Color(color) => {
                        *color = color.get_fallback(bump, lowest_fallback);
                    }
                    TokenOrValue::Function(f) => {
                        *f = f.get_fallback(bump, lowest_fallback);
                    }
                    TokenOrValue::Var(v) => {
                        if let Some(fallback) = &mut v.fallback {
                            *fallback = fallback.get_fallback(bump, lowest_fallback);
                        }
                    }
                    TokenOrValue::Env(v) => {
                        if let Some(fallback) = &mut v.fallback {
                            *fallback = fallback.get_fallback(bump, lowest_fallback);
                        }
                    }
                    _ => {}
                }
            }
        }

        res
    }

    pub fn get_necessary_fallbacks(&self, targets: css::targets::Targets) -> ColorFallbackKind {
        let mut fallbacks = ColorFallbackKind::empty();
        for token_or_value in self.v.iter() {
            match token_or_value {
                TokenOrValue::Color(color) => {
                    fallbacks.insert(color.get_possible_fallbacks(targets));
                }
                TokenOrValue::Function(f) => {
                    fallbacks.insert(f.arguments.get_necessary_fallbacks(targets));
                }
                TokenOrValue::Var(v) => {
                    if let Some(fallback) = &v.fallback {
                        fallbacks.insert(fallback.get_necessary_fallbacks(targets));
                    }
                }
                TokenOrValue::Env(v) => {
                    if let Some(fallback) = &v.fallback {
                        fallbacks.insert(fallback.get_necessary_fallbacks(targets));
                    }
                }
                _ => {}
            }
        }

        fallbacks
    }

    // eql / hash / deep_clone — provided by `#[derive(CssEql, CssHash, DeepClone)]`.
}

pub type TokenListFns = TokenList;

pub type Fallbacks = (SupportsCondition, TokenList);

/// A color value with an unresolved alpha value (e.g. a variable).
/// These can be converted from the modern slash syntax to older comma syntax.
/// This can only be done when the only unresolved component is the alpha
/// since variables can resolve to multiple tokens.
#[derive(CssEql, CssHash, DeepClone)]
pub enum UnresolvedColor {
    /// An rgb() color.
    RGB {
        /// The red component.
        r: f32,
        /// The green component.
        g: f32,
        /// The blue component.
        b: f32,
        /// The unresolved alpha component.
        alpha: TokenList,
    },
    /// An hsl() color.
    HSL {
        /// The hue component.
        h: f32,
        /// The saturation component.
        s: f32,
        /// The lightness component.
        l: f32,
        /// The unresolved alpha component.
        alpha: TokenList,
    },
    /// The light-dark() function.
    LightDark {
        /// The light value.
        light: TokenList,
        /// The dark value.
        dark: TokenList,
    },
}

impl UnresolvedColor {
    // eql / hash / deep_clone — provided by `#[derive(CssEql, CssHash, DeepClone)]`.

    // deinit(): body only freed owned `TokenList` fields — handled by `Drop`.

    pub fn to_css(&self, dest: &mut Printer, is_custom_property: bool) -> PrintResult<()> {
        fn conv(c: f32) -> i32 {
            css_values::color::clamp_unit_f32(c) as i32
        }

        match self {
            UnresolvedColor::RGB { r, g, b, alpha } => {
                if dest
                    .targets
                    .should_compile_same(css::compat::Feature::SpaceSeparatedColorNotation)
                {
                    dest.write_str("rgba(")?;
                    css_parser::to_css::integer(conv(*r), dest)?;
                    dest.delim(b',', false)?;
                    css_parser::to_css::integer(conv(*g), dest)?;
                    dest.delim(b',', false)?;
                    css_parser::to_css::integer(conv(*b), dest)?;
                    alpha.to_css(dest, is_custom_property)?;
                    dest.write_char(b')')?;
                    return Ok(());
                }

                dest.write_str("rgb(")?;
                css_parser::to_css::integer(conv(*r), dest)?;
                dest.write_char(b' ')?;
                css_parser::to_css::integer(conv(*g), dest)?;
                dest.write_char(b' ')?;
                css_parser::to_css::integer(conv(*b), dest)?;
                dest.delim(b'/', true)?;
                alpha.to_css(dest, is_custom_property)?;
                dest.write_char(b')')
            }
            UnresolvedColor::HSL { h, s, l, alpha } => {
                if dest
                    .targets
                    .should_compile_same(css::compat::Feature::SpaceSeparatedColorNotation)
                {
                    dest.write_str("hsla(")?;
                    CSSNumberFns::to_css(h, dest)?;
                    dest.delim(b',', false)?;
                    Percentage { v: *s }.to_css(dest)?;
                    dest.delim(b',', false)?;
                    Percentage { v: *l }.to_css(dest)?;
                    dest.delim(b',', false)?;
                    alpha.to_css(dest, is_custom_property)?;
                    dest.write_char(b')')?;
                    return Ok(());
                }

                dest.write_str("hsl(")?;
                CSSNumberFns::to_css(h, dest)?;
                dest.write_char(b' ')?;
                Percentage { v: *s }.to_css(dest)?;
                dest.write_char(b' ')?;
                Percentage { v: *l }.to_css(dest)?;
                dest.delim(b'/', true)?;
                alpha.to_css(dest, is_custom_property)?;
                dest.write_char(b')')
            }
            UnresolvedColor::LightDark { light, dark } => {
                if !dest.targets.is_compatible(css::compat::Feature::LightDark) {
                    dest.write_str("var(--buncss-light")?;
                    dest.delim(b',', false)?;
                    light.to_css(dest, is_custom_property)?;
                    dest.write_char(b')')?;
                    dest.whitespace()?;
                    dest.write_str("var(--buncss-dark")?;
                    dest.delim(b',', false)?;
                    dark.to_css(dest, is_custom_property)?;
                    return dest.write_char(b')');
                }

                dest.write_str("light-dark(")?;
                light.to_css(dest, is_custom_property)?;
                dest.delim(b',', false)?;
                dark.to_css(dest, is_custom_property)?;
                dest.write_char(b')')
            }
        }
    }

    pub fn parse(
        input: &mut Parser,
        f: &[u8],
        options: &ParserOptions,
        depth: usize,
    ) -> Result<UnresolvedColor> {
        use css_values::color::{
            ComponentParser, HSL, SRGB, parse_hsl_hwb_components, parse_rgb_components,
        };
        let mut parser = ComponentParser::new(false);
        crate::match_ignore_ascii_case! { f, {
            b"rgb" => return input.parse_nested_block(|input2| {
                parser.parse_relative::<SRGB, UnresolvedColor, _>(input2, |i, p| {
                    let (r, g, b, is_legacy) = parse_rgb_components(i, p)?;
                    if is_legacy {
                        return Err(i.new_custom_error(ParserError::invalid_value));
                    }
                    i.expect_delim(b'/')?;
                    let alpha = TokenListFns::parse(i, options, depth + 1)?;
                    Ok(UnresolvedColor::RGB { r, g, b, alpha })
                })
            }),
            b"hsl" => return input.parse_nested_block(|input2| {
                parser.parse_relative::<HSL, UnresolvedColor, _>(input2, |i, p| {
                    let (h, s, l, is_legacy) = parse_hsl_hwb_components::<HSL>(i, p, false)?;
                    if is_legacy {
                        return Err(i.new_custom_error(ParserError::invalid_value));
                    }
                    i.expect_delim(b'/')?;
                    let alpha = TokenListFns::parse(i, options, depth + 1)?;
                    Ok(UnresolvedColor::HSL { h, s, l, alpha })
                })
            }),
            b"light-dark" => return input.parse_nested_block(|input2| {
                // errdefer doesn't fire on `return .{ .err = ... }` in Zig — but in Rust,
                // `?` drops `light` automatically on the error path.
                let light = input2.parse_until_before(Delimiters::COMMA, |i| {
                    TokenListFns::parse(i, options, depth + 1)
                })?;
                input2.expect_comma()?;
                let dark = TokenListFns::parse(input2, options, depth + 1)?;
                Ok(UnresolvedColor::LightDark { light, dark })
            }),
            _ => {},
        }}
        Err(input.new_custom_error(ParserError::invalid_value))
    }

    pub fn light_dark_owned(light: UnresolvedColor, dark: UnresolvedColor) -> UnresolvedColor {
        let mut lightlist: Vec<TokenOrValue> = Vec::with_capacity(1);
        lightlist.push(TokenOrValue::UnresolvedColor(light));
        let mut darklist: Vec<TokenOrValue> = Vec::with_capacity(1);
        darklist.push(TokenOrValue::UnresolvedColor(dark));
        UnresolvedColor::LightDark {
            light: TokenList { v: lightlist },
            dark: TokenList { v: darklist },
        }
    }
}

// `ComponentParser::parse_relative` is generic over `C: LightDarkOwned` so the
// `from light-dark(...)` relative-color path can rebuild a `light-dark()` of
// whatever output type the caller is producing. Zig duck-types this via
// `lightDarkOwned` on both `CssColor` and `UnresolvedColor`; in Rust the trait
// lives in `values::color` and we wire `UnresolvedColor` into it here.
impl css_values::color::LightDarkOwned for UnresolvedColor {
    #[inline]
    fn light_dark_owned(light: Self, dark: Self) -> Self {
        UnresolvedColor::light_dark_owned(light, dark)
    }
}

/// A CSS variable reference.
#[derive(CssEql, CssHash, DeepClone)]
pub struct Variable {
    /// The variable name.
    pub name: DashedIdentReference,
    /// A fallback value in case the variable is not defined.
    pub fallback: Option<TokenList>,
}

impl Variable {
    // deinit(): body only freed owned `TokenList` field — handled by `Drop`.

    pub fn parse(input: &mut Parser, options: &ParserOptions, depth: usize) -> Result<Self> {
        let name = ext::dashed_ident_ref_parse(input, options)?;

        let fallback = if input.try_parse(|i| i.expect_comma()).is_ok() {
            Some(TokenList::parse(input, options, depth)?)
        } else {
            None
        };

        Ok(Variable { name, fallback })
    }

    pub fn to_css(&self, dest: &mut Printer, is_custom_property: bool) -> PrintResult<()> {
        dest.write_str("var(")?;
        ext::dashed_ident_ref_to_css(&self.name, dest)?;
        if let Some(fallback) = &self.fallback {
            dest.delim(b',', false)?;
            fallback.to_css(dest, is_custom_property)?;
        }
        dest.write_char(b')')
    }

    pub fn get_fallback(&self, bump: &Arena, kind: ColorFallbackKind) -> Self {
        Variable {
            name: self.name,
            fallback: self
                .fallback
                .as_ref()
                .map(|fallback| fallback.get_fallback(bump, kind)),
        }
    }

    // eql / hash / deep_clone — provided by `#[derive(CssEql, CssHash, DeepClone)]`.
}

/// A CSS environment variable reference.
#[derive(CssEql, CssHash, DeepClone)]
pub struct EnvironmentVariable {
    /// The environment variable name.
    pub name: EnvironmentVariableName,
    /// Optional indices into the dimensions of the environment variable.
    /// TODO(zack): this could totally be a smallvec, why isn't it?
    pub indices: Vec<CSSInteger>,
    /// A fallback value in case the variable is not defined.
    pub fallback: Option<TokenList>,
}

impl EnvironmentVariable {
    // deinit(): body only freed owned `Vec`/`TokenList` fields — handled by `Drop`.

    pub fn parse(
        input: &mut Parser,
        options: &ParserOptions,
        depth: usize,
    ) -> Result<EnvironmentVariable> {
        input.expect_function_matching(b"env")?;
        input.parse_nested_block(|i| EnvironmentVariable::parse_nested(i, options, depth))
    }

    pub fn parse_nested(
        input: &mut Parser,
        options: &ParserOptions,
        depth: usize,
    ) -> Result<EnvironmentVariable> {
        let name = EnvironmentVariableName::parse(input)?;
        let mut indices: Vec<i32> = Vec::new();
        while let Ok(idx) = input.try_parse(CSSIntegerFns::parse) {
            indices.push(idx);
        }

        let fallback = if input.try_parse(|i| i.expect_comma()).is_ok() {
            Some(TokenListFns::parse(input, options, depth + 1)?)
        } else {
            None
        };

        Ok(EnvironmentVariable {
            name,
            indices,
            fallback,
        })
    }

    pub fn to_css(&self, dest: &mut Printer, is_custom_property: bool) -> PrintResult<()> {
        dest.write_str("env(")?;
        self.name.to_css(dest)?;

        for index in self.indices.iter() {
            dest.write_char(b' ')?;
            css_parser::to_css::integer(*index, dest)?;
        }

        if let Some(fallback) = &self.fallback {
            dest.delim(b',', false)?;
            fallback.to_css(dest, is_custom_property)?;
        }

        dest.write_char(b')')
    }

    pub fn get_fallback(&self, bump: &Arena, kind: ColorFallbackKind) -> Self {
        EnvironmentVariable {
            name: self.name.clone(),
            indices: self.indices.clone(),
            fallback: self
                .fallback
                .as_ref()
                .map(|fallback| fallback.get_fallback(bump, kind)),
        }
    }

    // eql / hash / deep_clone — provided by `#[derive(CssEql, CssHash, DeepClone)]`.
}

/// A CSS environment variable name.
#[derive(Clone, Copy, CssEql, CssHash, DeepClone)]
pub enum EnvironmentVariableName {
    /// A UA-defined environment variable.
    Ua(UAEnvironmentVariable),
    /// A custom author-defined environment variable.
    Custom(DashedIdentReference),
    /// An unknown environment variable.
    Unknown(CustomIdent),
}

impl EnvironmentVariableName {
    // eql / hash — provided by `#[derive(CssEql, CssHash)]`.

    pub fn parse(input: &mut Parser) -> Result<EnvironmentVariableName> {
        if let Ok(ua) = input.try_parse(UAEnvironmentVariable::parse) {
            return Ok(EnvironmentVariableName::Ua(ua));
        }

        if let Ok(dashed) =
            input.try_parse(|i| ext::dashed_ident_ref_parse(i, &ParserOptions::default(None)))
        {
            return Ok(EnvironmentVariableName::Custom(dashed));
        }

        let ident = CustomIdentFns::parse(input)?;
        Ok(EnvironmentVariableName::Unknown(ident))
    }

    pub fn to_css(&self, dest: &mut Printer) -> PrintResult<()> {
        match self {
            EnvironmentVariableName::Ua(ua) => ua.to_css(dest),
            EnvironmentVariableName::Custom(custom) => ext::dashed_ident_ref_to_css(custom, dest),
            EnvironmentVariableName::Unknown(unknown) => ext::custom_ident_to_css(unknown, dest),
        }
    }
}

/// A UA-defined environment variable name.
// PORT NOTE: Zig `css.DefineEnumProperty(@This())` provides eql/hash/parse/
// to_css/deep_clone via comptime reflection over @tagName. Replaced by an
// `EnumProperty` impl below (kebab-case match) — same protocol surface.
#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr, CssHash)]
pub enum UAEnvironmentVariable {
    /// The safe area inset from the top of the viewport.
    #[strum(serialize = "safe-area-inset-top")]
    SafeAreaInsetTop,
    /// The safe area inset from the right of the viewport.
    #[strum(serialize = "safe-area-inset-right")]
    SafeAreaInsetRight,
    /// The safe area inset from the bottom of the viewport.
    #[strum(serialize = "safe-area-inset-bottom")]
    SafeAreaInsetBottom,
    /// The safe area inset from the left of the viewport.
    #[strum(serialize = "safe-area-inset-left")]
    SafeAreaInsetLeft,
    /// The viewport segment width.
    #[strum(serialize = "viewport-segment-width")]
    ViewportSegmentWidth,
    /// The viewport segment height.
    #[strum(serialize = "viewport-segment-height")]
    ViewportSegmentHeight,
    /// The viewport segment top position.
    #[strum(serialize = "viewport-segment-top")]
    ViewportSegmentTop,
    /// The viewport segment left position.
    #[strum(serialize = "viewport-segment-left")]
    ViewportSegmentLeft,
    /// The viewport segment bottom position.
    #[strum(serialize = "viewport-segment-bottom")]
    ViewportSegmentBottom,
    /// The viewport segment right position.
    #[strum(serialize = "viewport-segment-right")]
    ViewportSegmentRight,
}

// hash — via `#[derive(CssHash)]` (the derive emits UFCS, so no inherent shim needed).
impl UAEnvironmentVariable {
    #[inline]
    pub fn eql(&self, other: &Self) -> bool {
        *self == *other
    }
    #[inline]
    pub fn deep_clone(&self, _bump: &Arena) -> Self {
        *self
    }
}

impl EnumProperty for UAEnvironmentVariable {
    fn from_ascii_case_insensitive(ident: &[u8]) -> Option<Self> {
        // css.todo_stuff.match_ignore_ascii_case — Phase B: phf table.
        use UAEnvironmentVariable::*;
        const TABLE: &[(&[u8], UAEnvironmentVariable)] = &[
            (b"safe-area-inset-top", SafeAreaInsetTop),
            (b"safe-area-inset-right", SafeAreaInsetRight),
            (b"safe-area-inset-bottom", SafeAreaInsetBottom),
            (b"safe-area-inset-left", SafeAreaInsetLeft),
            (b"viewport-segment-width", ViewportSegmentWidth),
            (b"viewport-segment-height", ViewportSegmentHeight),
            (b"viewport-segment-top", ViewportSegmentTop),
            (b"viewport-segment-left", ViewportSegmentLeft),
            (b"viewport-segment-bottom", ViewportSegmentBottom),
            (b"viewport-segment-right", ViewportSegmentRight),
        ];
        for (k, v) in TABLE {
            if strings::eql_case_insensitive_ascii_check_length(ident, k) {
                return Some(*v);
            }
        }
        None
    }
}

/// A custom CSS function.
#[derive(CssEql, CssHash, DeepClone)]
pub struct Function {
    /// The function name.
    pub name: Ident,
    /// The function arguments.
    pub arguments: TokenList,
}

impl Function {
    // deinit(): body only freed owned `TokenList` field — handled by `Drop`.

    pub fn to_css(&self, dest: &mut Printer, is_custom_property: bool) -> PrintResult<()> {
        IdentFns::to_css(&self.name, dest)?;
        dest.write_char(b'(')?;
        self.arguments.to_css(dest, is_custom_property)?;
        dest.write_char(b')')
    }

    // eql / hash / deep_clone — provided by `#[derive(CssEql, CssHash, DeepClone)]`.

    pub fn get_fallback(&self, bump: &Arena, kind: ColorFallbackKind) -> Self {
        Function {
            name: self.name,
            arguments: self.arguments.get_fallback(bump, kind),
        }
    }
}

/// A raw CSS token, or a parsed value.
#[derive(CssEql, CssHash, DeepClone)]
pub enum TokenOrValue {
    /// A token.
    Token(Token),
    /// A parsed CSS color.
    Color(CssColor),
    /// A color with unresolved components.
    UnresolvedColor(UnresolvedColor),
    /// A parsed CSS url.
    Url(Url),
    /// A CSS variable reference.
    Var(Variable),
    /// A CSS environment variable reference.
    Env(EnvironmentVariable),
    /// A custom CSS function.
    Function(Function),
    /// A length.
    Length(LengthValue),
    /// An angle.
    Angle(Angle),
    /// A time.
    Time(Time),
    /// A resolution.
    Resolution(Resolution),
    /// A dashed ident.
    DashedIdent(DashedIdent),
    /// An animation name.
    AnimationName(AnimationName),
}

impl TokenOrValue {
    // eql / hash / deep_clone — provided by `#[derive(CssEql, CssHash, DeepClone)]`.

    // deinit(): all arms only freed owned fields — handled by `Drop`.

    pub fn is_whitespace(&self) -> bool {
        matches!(self, TokenOrValue::Token(Token::Whitespace(_)))
    }
}

// ─── Clone / Debug shims ───────────────────────────────────────────────────
// `selectors::parser::PseudoElement` / `PseudoClass` derive `Clone` over a
// `TokenList` payload, and `media_query::MediaFeatureValue` derives
// `Debug + Clone` over an `EnvironmentVariable` payload. The leaf value types
// (`Url`, `CustomIdent`, …) don't all `#[derive(Clone)]` yet, so hand-roll
// the structural clone here. PORT NOTE: Zig had no `Clone` distinction —
// shallow struct copy was implicit; arena-slice payloads (`*const [u8]`) are
// `Copy`, and the only owning fields are `Vec<TokenOrValue>` / `Vec<i32>`.

impl Clone for TokenList {
    fn clone(&self) -> Self {
        TokenList { v: self.v.clone() }
    }
}

impl Clone for TokenOrValue {
    fn clone(&self) -> Self {
        match self {
            TokenOrValue::Token(t) => TokenOrValue::Token(t.clone()),
            TokenOrValue::Color(c) => TokenOrValue::Color(c.clone()),
            TokenOrValue::UnresolvedColor(c) => TokenOrValue::UnresolvedColor(c.clone()),
            // `Url` has no `#[derive(Clone)]` but both fields are `Copy`.
            TokenOrValue::Url(u) => TokenOrValue::Url(Url {
                import_record_idx: u.import_record_idx,
                loc: u.loc,
            }),
            TokenOrValue::Var(v) => TokenOrValue::Var(v.clone()),
            TokenOrValue::Env(e) => TokenOrValue::Env(e.clone()),
            TokenOrValue::Function(f) => TokenOrValue::Function(f.clone()),
            TokenOrValue::Length(v) => TokenOrValue::Length(*v),
            TokenOrValue::Angle(v) => TokenOrValue::Angle(*v),
            TokenOrValue::Time(v) => TokenOrValue::Time(*v),
            TokenOrValue::Resolution(v) => TokenOrValue::Resolution(*v),
            TokenOrValue::DashedIdent(v) => TokenOrValue::DashedIdent(*v),
            TokenOrValue::AnimationName(v) => TokenOrValue::AnimationName(v.clone()),
        }
    }
}

impl Clone for UnresolvedColor {
    fn clone(&self) -> Self {
        match self {
            UnresolvedColor::RGB { r, g, b, alpha } => UnresolvedColor::RGB {
                r: *r,
                g: *g,
                b: *b,
                alpha: alpha.clone(),
            },
            UnresolvedColor::HSL { h, s, l, alpha } => UnresolvedColor::HSL {
                h: *h,
                s: *s,
                l: *l,
                alpha: alpha.clone(),
            },
            UnresolvedColor::LightDark { light, dark } => UnresolvedColor::LightDark {
                light: light.clone(),
                dark: dark.clone(),
            },
        }
    }
}

impl Clone for Variable {
    fn clone(&self) -> Self {
        Variable {
            name: self.name,
            fallback: self.fallback.clone(),
        }
    }
}

impl Clone for EnvironmentVariable {
    fn clone(&self) -> Self {
        EnvironmentVariable {
            name: self.name,
            indices: self.indices.clone(),
            fallback: self.fallback.clone(),
        }
    }
}

impl Clone for Function {
    fn clone(&self) -> Self {
        Function {
            name: self.name,
            arguments: self.arguments.clone(),
        }
    }
}

impl core::fmt::Debug for EnvironmentVariable {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // Minimal — `media_query::MediaFeatureValue` derives `Debug`.
        f.debug_struct("EnvironmentVariable")
            .field("indices", &self.indices)
            .finish_non_exhaustive()
    }
}

/// A known property with an unparsed value.
///
/// This type is used when the value of a known property could not
/// be parsed, e.g. in the case css `var()` references are encountered.
/// In this case, the raw tokens are stored instead.
pub struct UnparsedProperty {
    /// The id of the property.
    pub property_id: css::properties::PropertyId,
    /// The property value, stored as a raw token list.
    pub value: TokenList,
}

impl UnparsedProperty {
    pub fn parse(
        property_id: css::properties::PropertyId,
        input: &mut Parser,
        options: &ParserOptions,
    ) -> Result<UnparsedProperty> {
        let value = input.parse_until_before(Delimiters::BANG | Delimiters::SEMICOLON, |i| {
            TokenList::parse(i, options, 0)
        })?;

        Ok(UnparsedProperty { property_id, value })
    }

    // un-gated B-2 round 10: PropertyId::{prefix, with_prefix} + deep_clone are real now.
    pub fn get_prefixed(
        &self,
        bump: &Arena,
        targets: css::targets::Targets,
        feature: css::prefixes::Feature,
    ) -> UnparsedProperty {
        let mut clone = self.deep_clone(bump);
        let prefix = self.property_id.prefix();
        clone.property_id = clone
            .property_id
            .with_prefix(targets.prefixes(prefix.or_none(), feature));
        clone
    }

    /// Returns a new UnparsedProperty with the same value and the given property id.
    // un-gated B-2 round 10: TokenList::deep_clone is real (arena-threaded).
    pub fn with_property_id(
        &self,
        bump: &Arena,
        property_id: css::properties::PropertyId,
    ) -> UnparsedProperty {
        UnparsedProperty {
            property_id,
            value: self.value.deep_clone(bump),
        }
    }

    pub fn deep_clone(&self, bump: &Arena) -> Self {
        UnparsedProperty {
            property_id: self.property_id.deep_clone(bump),
            value: self.value.deep_clone(bump),
        }
    }

    pub fn eql(&self, rhs: &Self) -> bool {
        // `PropertyId` is `Copy` (tag + optional `VendorPrefix`/`CustomPropertyName`)
        // and derives `PartialEq` in `properties_generated.rs` — use `==` directly.
        self.property_id == rhs.property_id && self.value.eql(&rhs.value)
    }
}

/// A CSS custom property, representing any unknown property.
pub struct CustomProperty {
    /// The name of the property.
    pub name: CustomPropertyName,
    /// The property value, stored as a raw token list.
    pub value: TokenList,
}

impl CustomProperty {
    pub fn parse(
        name: CustomPropertyName,
        input: &mut Parser,
        options: &ParserOptions,
    ) -> Result<CustomProperty> {
        let value = input
            .parse_until_before(Delimiters::BANG | Delimiters::SEMICOLON, |input2| {
                TokenListFns::parse(input2, options, 0)
            })?;

        Ok(CustomProperty { name, value })
    }

    pub fn deep_clone(&self, bump: &Arena) -> Self {
        CustomProperty {
            name: self.name.deep_clone(bump),
            value: self.value.deep_clone(bump),
        }
    }

    pub fn eql(&self, rhs: &Self) -> bool {
        self.name.eql(&rhs.name) && self.value.eql(&rhs.value)
    }
}

/// A CSS custom property name.
#[derive(Debug, Clone, Copy, CssEql, CssHash, DeepClone)]
pub enum CustomPropertyName {
    /// An author-defined CSS custom property.
    Custom(DashedIdent),
    /// An unknown CSS property.
    Unknown(Ident),
}

// PORT NOTE: `DashedIdent`/`Ident` carry `*const [u8]` arena slices and
// intentionally don't derive `PartialEq` (pointer-eq would be wrong).
// `PropertyId` derives `PartialEq`, so compare the underlying bytes here.
impl PartialEq for CustomPropertyName {
    fn eq(&self, other: &Self) -> bool {
        // SAFETY: arena-owned slices live for the parse session.
        unsafe { (&*self.as_ptr()).eq(&*other.as_ptr()) }
    }
}

impl CustomPropertyName {
    pub fn to_css(&self, dest: &mut Printer) -> PrintResult<()> {
        match self {
            CustomPropertyName::Custom(custom) => {
                // Spec custom.zig:1496-1501 → DashedIdent.toCss → dest.writeDashedIdent(ident, true),
                // which applies CSS-Modules dashed-ident renaming.
                dest.write_dashed_ident(custom, true)
            }
            CustomPropertyName::Unknown(unknown) => {
                // SAFETY: arena-owned slice valid for printer lifetime.
                let v = unsafe { crate::arena_str(unknown.v) };
                dest.serialize_identifier(v)
            }
        }
    }

    pub fn from_str(name: &[u8]) -> CustomPropertyName {
        if name.starts_with(b"--") {
            return CustomPropertyName::Custom(DashedIdent {
                v: std::ptr::from_ref::<[u8]>(name),
            });
        }
        CustomPropertyName::Unknown(Ident {
            v: std::ptr::from_ref::<[u8]>(name),
        })
    }

    #[inline]
    fn as_ptr(&self) -> *const [u8] {
        match self {
            CustomPropertyName::Custom(custom) => custom.v,
            CustomPropertyName::Unknown(unknown) => unknown.v,
        }
    }

    /// Borrow the underlying name slice.
    /// SAFETY: caller must ensure the parser arena outlives the borrow
    /// (slices are arena-owned `*const [u8]`; see `DashedIdent::as_slice`).
    #[inline]
    pub fn as_str(&self) -> &[u8] {
        // SAFETY: see doc comment.
        unsafe { crate::arena_str(self.as_ptr()) }
    }

    // deep_clone / eql — provided by `#[derive(DeepClone, CssEql)]`.
}

pub fn try_parse_color_token(
    f: &[u8],
    state: &ParserState,
    input: &mut Parser,
) -> Option<CssColor> {
    if strings::eql_any_case_insensitive_ascii(
        f,
        &[
            b"rgb",
            b"rgba",
            b"hsl",
            b"hsla",
            b"hwb",
            b"lab",
            b"lch",
            b"oklab",
            b"oklch",
            b"color",
            b"color-mix",
            b"light-dark",
        ],
    ) {
        let s = input.state();
        input.reset(state);
        if let Ok(color) = CssColor::parse(input) {
            return Some(color);
        }
        input.reset(&s);
    }

    None
}

// ported from: src/css/properties/custom.zig
