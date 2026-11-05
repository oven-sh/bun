//! CSS custom properties / `var()` / `env()` / unparsed token lists.
//
// `TokenList::{parse, parse_into, to_css, to_css_raw}`,
// `UnresolvedColor::{parse, to_css}`, `Variable::{parse, to_css}`,
// `EnvironmentVariable::{parse, parse_nested, to_css}`,
// `EnvironmentVariableName::{parse, to_css}`, `Function::to_css`,
// `CustomProperty::parse`, `UnparsedProperty::parse` are now real.

use crate as css;
use crate::PrintResult;
use crate::Token;
use crate::css_parser::{self, Delimiters, EnumProperty, Parser, ParserOptions, ParserState};
use crate::error::{BasicParseErrorKind, ParseError, ParserError, ParserErrorKind};
use crate::printer::Printer;

use crate::values as css_values;
use css_values::angle::Angle;
use css_values::color::{ColorFallbackKind, CssColor};
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

// ─── leaf fn inlines ───────────────────────────────────────────────────────
// `TokenList::{parse,to_css}` bottom out on a handful of leaf fns from
// `values/ident.rs` / `css_modules.rs`; inlined here so the hub does
// not circularly depend on those modules.
mod ext {
    use super::*;

    /// Forwarder to `DashedIdentReference::parse_with_options`. Honors
    /// `options.css_modules.dashed_idents` and parses the
    /// `from <specifier>` suffix when enabled.
    #[inline]
    pub(super) fn dashed_ident_ref_parse(
        input: &mut Parser,
        options: &ParserOptions,
    ) -> Result<DashedIdentReference> {
        DashedIdentReference::parse_with_options(input, options)
    }

    /// Forwarder to `DashedIdentReference::to_css`.
    #[inline]
    pub(super) fn dashed_ident_ref_to_css(
        this: &DashedIdentReference,
        dest: &mut Printer,
    ) -> PrintResult<()> {
        this.to_css(dest)
    }

    /// Inline of `CustomIdent::to_css`.
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
// their `hash` bodies in css_parser.rs forward to `generic::implement_*`
// which bound on these traits — provide them here so the cycle closes and
// `#[derive(CssEql/CssHash/DeepClone)]` on `TokenOrValue` resolves the
// `Token(Token)` arm. Hand-written (not derived) because `Token` carries
// `&'static [u8]` payloads (arena-lifetime placeholder) and named-field
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
        // All `&'static [u8]` payloads borrow the parser source/arena (`'static`
        // is a placeholder) — identity copy is correct. `Num`/`Dimension` are POD.
        *self
    }
}

// PERF: the token vecs here are plain global-alloc `Vec<TokenOrValue>`;
// Thread `&'bump Bump` if profiling shows it.

pub use css_parser::CssResult as Result;

/// PERF: nullable optimization
#[derive(Default, CssEql, CssHash, DeepClone)]
pub struct TokenList {
    pub(crate) v: Vec<TokenOrValue>,
}

impl TokenList {
    // deinit(): body only freed owned `Vec` fields — handled by `Drop` on `Vec`.

    pub fn to_css(&self, dest: &mut Printer, is_custom_property: bool) -> PrintResult<()> {
        if !dest.minify && self.v.len() == 1 && self.v[0].is_whitespace() {
            return Ok(());
        }

        // A blank can mean something (`.a .b`, `type(<number>)`): only the stored ones print.
        for (i, token_or_value) in self.v.iter().enumerate() {
            match token_or_value {
                TokenOrValue::Color(color) => color.to_css(dest)?,
                TokenOrValue::UnresolvedColor(color) => color.to_css(dest, is_custom_property)?,
                TokenOrValue::Url(url) => {
                    if dest.dependencies.is_some()
                        && is_custom_property
                        && !url.is_absolute(dest.get_import_records()?)
                    {
                        let pretty = std::ptr::from_ref::<[u8]>(
                            dest.get_import_records()?[url.import_record_idx as usize]
                                .path
                                .pretty,
                        );
                        return dest.new_error(
                            css::PrinterErrorKind::ambiguous_url_in_custom_property { url: pretty },
                            Some(url.loc),
                        );
                    }
                    url.to_css(dest)?;
                }
                TokenOrValue::Var(var) => var.to_css(dest, is_custom_property)?,
                TokenOrValue::Env(env) => env.to_css(dest, is_custom_property)?,
                TokenOrValue::Function(f) => f.to_css(dest, is_custom_property)?,
                TokenOrValue::Length(v) => {
                    // Do not serialize unitless zero lengths in custom properties as it may break calc().
                    let (value, unit) = v.to_unit_value();
                    css_parser::serializer::serialize_dimension(value, unit, dest)?;
                }
                TokenOrValue::Angle(v) => v.to_css(dest)?,
                TokenOrValue::Time(v) => v.to_css(dest)?,
                TokenOrValue::Resolution(v) => v.to_css(dest)?,
                TokenOrValue::DashedIdent(v) => dest.write_dashed_ident(v, true)?,
                TokenOrValue::AnimationName(v) => v.to_css(dest)?,
                TokenOrValue::RawNumber(number) => number.to_css(dest)?,
                TokenOrValue::Token(token) => match token {
                    Token::Whitespace(_) if dest.minify && self.can_omit_whitespace(i) => {}
                    Token::Comma => dest.delim(b',', false)?,
                    Token::Dimension(dim) => {
                        css_parser::serializer::serialize_dimension(dim.num.value, dim.unit, dest)?;
                    }
                    Token::Number(v) => CSSNumberFns::to_css(v.value, dest)?,
                    _ => token.to_css(dest)?,
                },
            }
        }
        Ok(())
    }

    /// Whether the items around the blank at `i` read the same without it.
    fn can_omit_whitespace(&self, i: usize) -> bool {
        let (Some(prev), Some(next)) = (self.v[..i].last(), self.v.get(i + 1)) else {
            return false;
        };
        let delim = |item: &TokenOrValue| match item {
            TokenOrValue::Token(Token::Delim(d)) => char::from_u32(*d),
            _ => None,
        };
        match (delim(prev), delim(next)) {
            // calc() needs the blanks around `+` and `-`.
            (Some('+' | '-'), _) | (_, Some('+' | '-')) => false,
            // `/*` and `*/` delimit a comment, `*=` is one token.
            (Some('/'), Some('*')) | (Some('*'), Some('/' | '=')) => false,
            (Some('/'), _) if matches!(next, TokenOrValue::Token(Token::SubstringMatch)) => false,
            (Some('*' | '/'), _) | (_, Some('*' | '/')) => true,
            _ => {
                let closes = |item: &TokenOrValue| {
                    matches!(
                        item,
                        TokenOrValue::Token(
                            Token::CloseParen | Token::CloseSquare | Token::CloseCurly
                        )
                    )
                };
                closes(prev)
                    || closes(next)
                    || matches!(
                        prev,
                        TokenOrValue::Var(_)
                            | TokenOrValue::Env(_)
                            | TokenOrValue::Function(_)
                            | TokenOrValue::Token(
                                Token::OpenParen | Token::OpenSquare | Token::OpenCurly
                            )
                    )
            }
        }
    }

    pub(crate) fn to_css_raw(&self, dest: &mut Printer) -> PrintResult<()> {
        for token_or_value in self.v.iter() {
            match token_or_value {
                TokenOrValue::Token(token) => token.to_css(dest)?,
                TokenOrValue::RawNumber(number) => number.to_css(dest)?,
                _ => return Err(dest.add_fmt_error()),
            }
        }
        Ok(())
    }

    pub fn parse(input: &mut Parser, options: &ParserOptions, depth: usize) -> Result<TokenList> {
        let mut tokens: Vec<TokenOrValue> = Vec::new();
        TokenListFns::parse_into(input, &mut tokens, options, depth)?;

        // Slice off leading and trailing whitespace if there are at least two tokens.
        // If there is only one token, we must preserve it. e.g. `--foo: ;` is valid.
        if tokens.len() >= 2 {
            if tokens[tokens.len() - 1].is_whitespace() {
                tokens.pop();
            }
            if tokens[0].is_whitespace() {
                tokens.remove(0);
            }
        }

        Ok(TokenList { v: tokens })
    }

    pub(crate) fn parse_raw(
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
                    let tok = *token;
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
                    tokens.push(TokenOrValue::Token(*token));
                    input.parse_nested_block(|input2| {
                        TokenListFns::parse_raw(input2, tokens, options, depth + 1)
                    })?;
                    tokens.push(TokenOrValue::Token(Token::CloseParen));
                }
                _ => {
                    if token.is_parse_error() {
                        return Err(ParseError {
                            kind: ParserErrorKind::basic(BasicParseErrorKind::unexpected_token(
                                *token,
                            )),
                            location: state.source_location(),
                        });
                    }
                    let token = *token;
                    tokens.push(match input.raw_number_text() {
                        Some(text) => TokenOrValue::RawNumber(RawNumber(text)),
                        None => TokenOrValue::Token(token),
                    });
                }
            }
        }

        Ok(())
    }

    pub(crate) fn parse_into(
        input: &mut Parser,
        tokens: &mut Vec<TokenOrValue>,
        options: &ParserOptions,
        depth: usize,
    ) -> Result<()> {
        let result = Self::parse_into_impl(input, tokens, options, depth);
        if result.is_err() {
            // See `ParserInput::token_list_parse_failures`.
            input.note_token_list_parse_failure();
        }
        result
    }

    fn parse_into_impl(
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
            let Ok(tok) = input.next_including_whitespace_and_comments() else {
                break;
            };
            // Clone the token so we can call &mut methods on `input` below.
            let tok = *tok;
            match &tok {
                Token::Whitespace(_) | Token::Comment(_) => {
                    // A run of whitespace and comments is one space, or nothing next to a comma.
                    if !matches!(
                        tokens.last(),
                        Some(TokenOrValue::Token(Token::Whitespace(_) | Token::Comma))
                    ) {
                        tokens.push(TokenOrValue::Token(Token::Whitespace(b" ")));
                    }
                    continue;
                }
                Token::Comma => {
                    if tokens.last().is_some_and(TokenOrValue::is_whitespace) {
                        tokens.pop();
                    }
                }
                Token::Function(f) => {
                    // Attempt to parse embedded color values into hex tokens.
                    if let Some(color) = try_parse_color_token(f, &state, input) {
                        tokens.push(TokenOrValue::Color(color));
                        continue;
                    }
                    let failures_before = input.token_list_parse_failures();
                    match input.try_parse(|i| UnresolvedColor::parse(i, f, options, depth)) {
                        Ok(color) => {
                            tokens.push(TokenOrValue::UnresolvedColor(color));
                            continue;
                        }
                        Err(err) => {
                            // The attempt failed inside one of its token-list
                            // arguments (an rgb()/hsl() alpha or a light-dark()
                            // half). Those tokens fail the same way under every
                            // alternative below, so propagate instead of
                            // falling through: re-parsing the arguments once
                            // per alternative is exponential in the nesting
                            // depth when such functions are nested.
                            if input.token_list_parse_failures() != failures_before {
                                return Err(err);
                            }
                        }
                    }
                    if strings::eql(*f, b"url") && !input.flags.raw_url_tokens() {
                        input.reset(&state);
                        tokens.push(TokenOrValue::Url(Url::parse(input)?));
                    } else if strings::eql(*f, b"var") {
                        let var = input.parse_nested_block(|input2| {
                            let thevar = Variable::parse(input2, options, depth + 1)?;
                            Ok(TokenOrValue::Var(thevar))
                        })?;
                        tokens.push(var);
                    } else if strings::eql(*f, b"env") {
                        let env = input.parse_nested_block(|input2| {
                            let env =
                                EnvironmentVariable::parse_nested(input2, options, depth + 1)?;
                            Ok(TokenOrValue::Env(env))
                        })?;
                        tokens.push(env);
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
                    }
                    continue;
                }
                Token::UnrestrictedHash(h) | Token::IdHash(h) => {
                    'brk: {
                        let Some(rgba) = css_parser::color::parse_hash_color(h) else {
                            tokens.push(TokenOrValue::Token(Token::UnrestrictedHash(*h)));
                            break 'brk;
                        };
                        tokens.push(TokenOrValue::Color(CssColor::Rgba(rgba)));
                    }
                    continue;
                }
                Token::UnquotedUrl(_) if !input.flags.raw_url_tokens() => {
                    input.reset(&state);
                    tokens.push(TokenOrValue::Url(Url::parse(input)?));
                    continue;
                }
                Token::Ident(name) => {
                    if name.starts_with(b"--") {
                        tokens.push(TokenOrValue::DashedIdent(DashedIdent {
                            v: std::ptr::from_ref::<[u8]>(*name),
                        }));
                        continue;
                    }
                    if strings::eql_case_insensitive_ascii_check_length(name, b"revert-rule") {
                        input.note_may_revert_rule();
                    }
                }
                Token::OpenParen | Token::OpenSquare | Token::OpenCurly => {
                    let closing_delimiter = match &tok {
                        Token::OpenParen => Token::CloseParen,
                        Token::OpenSquare => Token::CloseSquare,
                        Token::OpenCurly => Token::CloseCurly,
                        _ => unreachable!(),
                    };
                    tokens.push(TokenOrValue::Token(tok));
                    input.parse_nested_block(|input2| {
                        TokenListFns::parse_into(input2, tokens, options, depth + 1)
                    })?;
                    tokens.push(TokenOrValue::Token(closing_delimiter));
                    continue;
                }
                Token::Number(_) | Token::Percentage { .. } => {
                    if let Some(text) = input.raw_number_text() {
                        tokens.push(TokenOrValue::RawNumber(RawNumber(text)));
                        continue;
                    }
                }
                Token::Dimension(_) => {
                    let value = if let Some(text) = input.raw_number_text() {
                        TokenOrValue::RawNumber(RawNumber(text))
                    } else if let Ok(length) = LengthValue::try_from_token(&tok) {
                        TokenOrValue::Length(length)
                    } else if let Ok(angle) = Angle::try_from_token(&tok) {
                        TokenOrValue::Angle(angle)
                    } else if let Ok(time) = Time::try_from_token(&tok) {
                        TokenOrValue::Time(time)
                    } else if let Ok(resolution) = Resolution::try_from_token(&tok) {
                        TokenOrValue::Resolution(resolution)
                    } else {
                        TokenOrValue::Token(tok)
                    };

                    tokens.push(value);
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
            tokens.push(TokenOrValue::Token(tok));
        }

        Ok(())
    }

    pub(crate) fn get_fallback(&self, bump: &Arena, kind: ColorFallbackKind) -> Self {
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

    pub(crate) fn get_fallbacks(
        &mut self,
        bump: &Arena,
        targets: &css::targets::Targets,
    ) -> css::SmallList<Fallbacks, 2> {
        // Get the full list of possible fallbacks, and remove the lowest one, which will replace
        // the original declaration. The remaining fallbacks need to be added as @supports rules.
        let mut fallbacks = self.get_necessary_fallbacks(targets);
        let lowest_fallback = fallbacks.lowest();
        fallbacks.remove(lowest_fallback);

        let mut res = css::SmallList::<Fallbacks, 2>::default();
        if fallbacks.contains(ColorFallbackKind::P3) {
            res.append((
                ColorFallbackKind::P3.supports_condition(),
                self.get_fallback(bump, ColorFallbackKind::P3),
            ));
        }

        if fallbacks.contains(ColorFallbackKind::LAB) {
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

    pub(crate) fn get_necessary_fallbacks(
        &self,
        targets: &css::targets::Targets,
    ) -> ColorFallbackKind {
        let mut fallbacks = ColorFallbackKind::empty();
        for token_or_value in self.v.iter() {
            match token_or_value {
                TokenOrValue::Color(color) => {
                    fallbacks.insert(color.get_possible_fallbacks(targets));
                }
                TokenOrValue::Function(f) if !f.is_relative_color() => {
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

pub(crate) type Fallbacks = (SupportsCondition, TokenList);

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

    fn to_css(&self, dest: &mut Printer, is_custom_property: bool) -> PrintResult<()> {
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
                    dest.delim(b',', false)?;
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
                    CSSNumberFns::to_css(*h, dest)?;
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
                CSSNumberFns::to_css(*h, dest)?;
                dest.write_char(b' ')?;
                Percentage { v: *s }.to_css(dest)?;
                dest.write_char(b' ')?;
                Percentage { v: *l }.to_css(dest)?;
                dest.delim(b'/', true)?;
                alpha.to_css(dest, is_custom_property)?;
                dest.write_char(b')')
            }
            UnresolvedColor::LightDark { light, dark } => {
                if dest
                    .targets
                    .should_compile_same(css::compat::Feature::LightDark)
                {
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

    fn parse(
        input: &mut Parser,
        f: &[u8],
        options: &ParserOptions,
        depth: usize,
    ) -> Result<UnresolvedColor> {
        use css_values::color::{
            ComponentParser, HSL, RgbComponents, SRGB, parse_hsl_hwb_components,
            parse_rgb_components,
        };
        let mut parser = ComponentParser::new(false);
        crate::match_ignore_ascii_case! { f, {
            b"rgb" => return input.parse_nested_block(|input2| {
                parser.parse_relative::<SRGB, UnresolvedColor, _>(input2, |i, p| {
                    let RgbComponents { r, g, b, is_legacy } = parse_rgb_components(i, p)?;
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
                    let (h, s, l, is_legacy) = parse_hsl_hwb_components(i, p, false)?;
                    if is_legacy {
                        return Err(i.new_custom_error(ParserError::invalid_value));
                    }
                    i.expect_delim(b'/')?;
                    let alpha = TokenListFns::parse(i, options, depth + 1)?;
                    Ok(UnresolvedColor::HSL { h, s, l, alpha })
                })
            }),
            b"light-dark" => return input.parse_nested_block(|input2| {
                // light-dark() requires a top-level comma between its halves.
                // Check with a raw scan before parsing: buffering the first
                // half as a token list only to fail on the missing comma makes
                // the caller re-parse the arguments as a plain function, which
                // compounds exponentially when light-dark() calls are nested.
                let scan_start = input2.state();
                let mut found_comma = false;
                while let Ok(tok) = input2.next() {
                    if matches!(tok, Token::Comma) {
                        found_comma = true;
                        break;
                    }
                }
                input2.reset(&scan_start);
                if !found_comma {
                    return Err(input2.new_error(BasicParseErrorKind::end_of_input));
                }
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

    fn light_dark_owned(light: UnresolvedColor, dark: UnresolvedColor) -> UnresolvedColor {
        UnresolvedColor::LightDark {
            light: TokenList {
                v: vec![TokenOrValue::UnresolvedColor(light)],
            },
            dark: TokenList {
                v: vec![TokenOrValue::UnresolvedColor(dark)],
            },
        }
    }
}

// `ComponentParser::parse_relative` is generic over `C: LightDarkOwned` so the
// `from light-dark(...)` relative-color path can rebuild a `light-dark()` of
// whatever output type the caller is producing. The trait lives in
// `values::color` and we wire `UnresolvedColor` into it here.
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

    fn parse(input: &mut Parser, options: &ParserOptions, depth: usize) -> Result<Self> {
        let name = ext::dashed_ident_ref_parse(input, options)?;

        let fallback = if input.try_parse(|i| i.expect_comma()).is_ok() {
            Some(TokenList::parse(input, options, depth)?)
        } else {
            None
        };

        Ok(Variable { name, fallback })
    }

    fn to_css(&self, dest: &mut Printer, is_custom_property: bool) -> PrintResult<()> {
        dest.write_str("var(")?;
        ext::dashed_ident_ref_to_css(&self.name, dest)?;
        if let Some(fallback) = &self.fallback {
            dest.delim(b',', false)?;
            fallback.to_css(dest, is_custom_property)?;
        }
        dest.write_char(b')')
    }

    fn get_fallback(&self, bump: &Arena, kind: ColorFallbackKind) -> Self {
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
    pub(crate) indices: Vec<CSSInteger>,
    /// A fallback value in case the variable is not defined.
    pub fallback: Option<TokenList>,
}

impl EnvironmentVariable {
    // deinit(): body only freed owned `Vec`/`TokenList` fields — handled by `Drop`.

    pub(crate) fn parse(
        input: &mut Parser,
        options: &ParserOptions,
        depth: usize,
    ) -> Result<EnvironmentVariable> {
        input.expect_function_matching(b"env")?;
        input.parse_nested_block(|i| EnvironmentVariable::parse_nested(i, options, depth))
    }

    fn parse_nested(
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

    pub(crate) fn to_css(&self, dest: &mut Printer, is_custom_property: bool) -> PrintResult<()> {
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

    fn get_fallback(&self, bump: &Arena, kind: ColorFallbackKind) -> Self {
        EnvironmentVariable {
            name: self.name,
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

    fn parse(input: &mut Parser) -> Result<EnvironmentVariableName> {
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

    fn to_css(&self, dest: &mut Printer) -> PrintResult<()> {
        match self {
            EnvironmentVariableName::Ua(ua) => ua.to_css(dest),
            EnvironmentVariableName::Custom(custom) => ext::dashed_ident_ref_to_css(custom, dest),
            EnvironmentVariableName::Unknown(unknown) => ext::custom_ident_to_css(unknown, dest),
        }
    }
}

/// A UA-defined environment variable name.
// The `EnumProperty` impl below provides parse/to_css via a kebab-case match.
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
    pub(crate) fn eql(self, other: Self) -> bool {
        self == other
    }
}

impl EnumProperty for UAEnvironmentVariable {
    fn from_ascii_case_insensitive(ident: &[u8]) -> Option<Self> {
        // TODO(perf): css.todo_stuff.match_ignore_ascii_case — replace the
        // linear scan with a length-gated match.
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
    pub(crate) arguments: TokenList,
}

impl Function {
    // deinit(): body only freed owned `TokenList` field — handled by `Drop`.

    fn to_css(&self, dest: &mut Printer, is_custom_property: bool) -> PrintResult<()> {
        IdentFns::to_css(&self.name, dest)?;
        dest.write_char(b'(')?;
        self.arguments.to_css(dest, is_custom_property)?;
        dest.write_char(b')')
    }

    // eql / hash / deep_clone — provided by `#[derive(CssEql, CssHash, DeepClone)]`.

    /// Whether this is a relative color, as `rgb(from ...)`. A browser that reads one reads every
    /// color space, so its origin needs no fallback.
    fn is_relative_color(&self) -> bool {
        matches!(
            self.arguments.v.first(),
            Some(TokenOrValue::Token(Token::Ident(ident)))
                if strings::eql_case_insensitive_ascii_check_length(ident, b"from")
        ) && strings::eql_any_case_insensitive_ascii(
            self.name.v(),
            &[
                b"rgb", b"rgba", b"hsl", b"hsla", b"hwb", b"lab", b"lch", b"oklab", b"oklch",
                b"color",
            ],
        )
    }

    fn get_fallback(&self, bump: &Arena, kind: ColorFallbackKind) -> Self {
        Function {
            name: self.name,
            arguments: self.arguments.get_fallback(bump, kind),
        }
    }
}

/// The source text of a number, percentage or dimension token.
#[derive(Clone, Copy, CssEql, CssHash)]
pub struct RawNumber(&'static [u8]);

impl RawNumber {
    fn to_css(self, dest: &mut Printer) -> PrintResult<()> {
        dest.write_bytes(self.0)
    }
}

impl<'bump> DeepClone<'bump> for RawNumber {
    #[inline]
    fn deep_clone(&self, _bump: &'bump Arena) -> Self {
        // Borrows the parser source, as the slices of `Token` do.
        *self
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
    /// A numeric token that prints as written. See `Parser::raw_number_text`.
    RawNumber(RawNumber),
}

impl TokenOrValue {
    // eql / hash / deep_clone — provided by `#[derive(CssEql, CssHash, DeepClone)]`.

    // deinit(): all arms only freed owned fields — handled by `Drop`.

    fn is_whitespace(&self) -> bool {
        matches!(self, TokenOrValue::Token(Token::Whitespace(_)))
    }
}

// ─── Clone / Debug shims ───────────────────────────────────────────────────
// `selectors::parser::PseudoElement` / `PseudoClass` derive `Clone` over a
// `TokenList` payload, and `media_query::MediaFeatureValue` derives
// `Debug + Clone` over an `EnvironmentVariable` payload. The leaf value types
// (`Url`, `CustomIdent`, …) don't all `#[derive(Clone)]` yet, so hand-roll
// the structural clone here. Arena-slice payloads (`*const [u8]`) are
// `Copy`, and the only owning fields are `Vec<TokenOrValue>` / `Vec<i32>`.

impl Clone for TokenList {
    fn clone(&self) -> Self {
        TokenList { v: self.v.clone() }
    }
}

impl Clone for TokenOrValue {
    fn clone(&self) -> Self {
        match self {
            TokenOrValue::Token(t) => TokenOrValue::Token(*t),
            TokenOrValue::Color(c) => TokenOrValue::Color(c.clone()),
            TokenOrValue::UnresolvedColor(c) => TokenOrValue::UnresolvedColor(c.clone()),
            TokenOrValue::Url(u) => TokenOrValue::Url(u.clone()),
            TokenOrValue::Var(v) => TokenOrValue::Var(v.clone()),
            TokenOrValue::Env(e) => TokenOrValue::Env(e.clone()),
            TokenOrValue::Function(f) => TokenOrValue::Function(f.clone()),
            TokenOrValue::Length(v) => TokenOrValue::Length(*v),
            TokenOrValue::Angle(v) => TokenOrValue::Angle(*v),
            TokenOrValue::Time(v) => TokenOrValue::Time(*v),
            TokenOrValue::Resolution(v) => TokenOrValue::Resolution(*v),
            TokenOrValue::DashedIdent(v) => TokenOrValue::DashedIdent(*v),
            TokenOrValue::AnimationName(v) => TokenOrValue::AnimationName(*v),
            TokenOrValue::RawNumber(v) => TokenOrValue::RawNumber(*v),
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
    pub(crate) property_id: css::properties::PropertyId,
    /// The property value, stored as a raw token list.
    pub(crate) value: TokenList,
}

impl UnparsedProperty {
    pub(crate) fn parse(
        property_id: css::properties::PropertyId,
        input: &mut Parser,
        options: &ParserOptions,
    ) -> Result<UnparsedProperty> {
        let value = input.parse_until_before(Delimiters::BANG | Delimiters::SEMICOLON, |i| {
            TokenList::parse(i, options, 0)
        })?;

        Ok(UnparsedProperty { property_id, value })
    }

    pub(crate) fn get_prefixed(
        &self,
        bump: &Arena,
        targets: &css::targets::Targets,
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
    pub(crate) fn with_property_id(
        &self,
        bump: &Arena,
        property_id: css::properties::PropertyId,
    ) -> UnparsedProperty {
        UnparsedProperty {
            property_id,
            value: self.value.deep_clone(bump),
        }
    }

    pub(crate) fn deep_clone(&self, bump: &Arena) -> Self {
        UnparsedProperty {
            property_id: self.property_id.deep_clone(bump),
            value: self.value.deep_clone(bump),
        }
    }

    pub(crate) fn eql(&self, rhs: &Self) -> bool {
        self.property_id == rhs.property_id && self.value.eql(&rhs.value)
    }
}

/// A CSS custom property, representing any unknown property.
pub struct CustomProperty {
    /// The name of the property.
    pub name: CustomPropertyName,
    /// The property value, stored as a raw token list.
    pub(crate) value: TokenList,
}

impl CustomProperty {
    pub(crate) fn parse(
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

    pub(crate) fn deep_clone(&self, bump: &Arena) -> Self {
        CustomProperty {
            name: self.name.deep_clone(bump),
            value: self.value.deep_clone(bump),
        }
    }

    pub(crate) fn eql(&self, rhs: &Self) -> bool {
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

impl CustomPropertyName {
    pub fn to_css(&self, dest: &mut Printer) -> PrintResult<()> {
        match self {
            CustomPropertyName::Custom(custom) => {
                // DashedIdent.toCss → dest.writeDashedIdent(ident, true),
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

    pub(crate) fn from_str(name: &[u8]) -> CustomPropertyName {
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
    pub(crate) fn as_str(&self) -> &[u8] {
        // SAFETY: see doc comment.
        unsafe { crate::arena_str(self.as_ptr()) }
    }

    // deep_clone / eql — provided by `#[derive(DeepClone, CssEql)]`.
}

fn try_parse_color_token(f: &[u8], state: &ParserState, input: &mut Parser) -> Option<CssColor> {
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
