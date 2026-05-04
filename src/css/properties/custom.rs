use bun_css as css;
use bun_css::values as css_values;
use bun_css::{Printer, PrintErr};
use css_values::ident::{DashedIdent, DashedIdentFns, Ident, IdentFns};
pub use bun_css::Result;

pub use css_values::color::{CssColor, RGBA, SRGB, HSL, ComponentParser};
pub use css_values::number::{CSSInteger, CSSIntegerFns, CSSNumberFns};
pub use css_values::percentage::Percentage;
pub use css_values::url::Url;
pub use css_values::ident::{DashedIdentReference, CustomIdent, CustomIdentFns};
pub use css_values::length::LengthValue;
pub use css_values::angle::Angle;
pub use css_values::time::Time;
pub use css_values::resolution::Resolution;
pub use bun_css::properties::animation::AnimationName;

use bun_css::{SupportsCondition, ColorFallbackKind};
use bun_str::strings;
use bun_wyhash::Wyhash;

// PERF(port): css is listed as an AST crate (arena-backed) in PORTING.md, but
// LIFETIMES.tsv pre-classified the token vecs here as plain `Vec<TokenOrValue>`.
// Phase A drops allocator params and uses global-alloc `Vec`; Phase B may need
// to thread `&'bump Bump` if profiling shows it.

type PrintResult<T> = core::result::Result<T, PrintErr>;

/// PERF: nullable optimization
#[derive(Default)]
pub struct TokenList {
    pub v: Vec<TokenOrValue>,
}

impl TokenList {
    // deinit(): body only freed owned `Vec` fields — handled by `Drop` on `Vec`.

    pub fn to_css(
        &self,
        dest: &mut Printer,
        is_custom_property: bool,
    ) -> PrintResult<()> {
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
                    if dest.dependencies.is_some() && is_custom_property && !url.is_absolute(dest.get_import_records()?) {
                        return dest.new_error(
                            css::PrinterErrorKind::AmbiguousUrlInCustomProperty {
                                url: dest.get_import_records()?.at(url.import_record_idx).path.pretty,
                            },
                            url.loc,
                        );
                    }
                    url.to_css(dest)?;
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
                    css::serializer::serialize_dimension(value, unit, dest)?;
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
                    DashedIdentFns::to_css(v, dest)?;
                    has_whitespace = false;
                }
                TokenOrValue::AnimationName(v) => {
                    v.to_css(dest)?;
                    has_whitespace = false;
                }
                TokenOrValue::Token(token) => match token {
                    css::Token::Delim(d) => {
                        if *d == '+' as u32 || *d == '-' as u32 {
                            dest.write_char(' ')?;
                            debug_assert!(*d <= 0x7F);
                            dest.write_char(u8::try_from(*d).unwrap() as char)?;
                            dest.write_char(' ')?;
                        } else {
                            let ws_before = !has_whitespace && (*d == '/' as u32 || *d == '*' as u32);
                            debug_assert!(*d <= 0x7F);
                            dest.delim(u8::try_from(*d).unwrap() as char, ws_before)?;
                        }
                        has_whitespace = true;
                    }
                    css::Token::Comma => {
                        dest.delim(',', false)?;
                        has_whitespace = true;
                    }
                    css::Token::CloseParen | css::Token::CloseSquare | css::Token::CloseCurly => {
                        token.to_css(dest)?;
                        has_whitespace = self.write_whitespace_if_needed(i, dest)?;
                    }
                    css::Token::Dimension { num, unit, .. } => {
                        css::serializer::serialize_dimension(num.value, unit, dest)?;
                        has_whitespace = false;
                    }
                    css::Token::Number(v) => {
                        CSSNumberFns::to_css(&v.value, dest)?;
                        has_whitespace = false;
                    }
                    _ => {
                        token.to_css(dest)?;
                        has_whitespace = matches!(token, css::Token::Whitespace(_));
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
                return dest.add_fmt_error();
            }
        }
        Ok(())
    }

    pub fn write_whitespace_if_needed(
        &self,
        i: usize,
        dest: &mut Printer,
    ) -> PrintResult<bool> {
        if !dest.minify
            && i != self.v.len() - 1
            && !(matches!(
                &self.v[i + 1],
                TokenOrValue::Token(css::Token::Comma | css::Token::CloseParen)
            ))
        {
            // Whitespace is removed during parsing, so add it back if we aren't minifying.
            dest.write_char(' ')?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub fn parse(input: &mut css::Parser, options: &css::ParserOptions, depth: usize) -> Result<TokenList> {
        let mut tokens: Vec<TokenOrValue> = Vec::new(); // PERF: deinit on error
        TokenListFns::parse_into(input, &mut tokens, options, depth)?;

        // Slice off leading and trailing whitespace if there are at least two tokens.
        // If there is only one token, we must preserve it. e.g. `--foo: ;` is valid.
        // PERF(alloc): this feels like a common codepath, idk how I feel about reallocating a new array just to slice off whitespace.
        if tokens.len() >= 2 {
            let mut slice = &tokens[..];
            if !tokens.is_empty() && tokens[0].is_whitespace() {
                slice = &slice[1..];
            }
            if !tokens.is_empty() && tokens[tokens.len() - 1].is_whitespace() {
                slice = &slice[..slice.len() - 1];
            }
            // TODO(port): Zig `insertSlice(0, slice)` then deinit old; here we deep-clone the
            // borrowed range. Phase B could `drain` in place to avoid the clone.
            let newlist: Vec<TokenOrValue> = slice.iter().map(|t| t.deep_clone()).collect();
            drop(tokens);
            return Ok(TokenList { v: newlist });
        }

        Ok(TokenList { v: tokens })
    }

    pub fn parse_with_options(input: &mut css::Parser, options: &css::ParserOptions) -> Result<TokenList> {
        Self::parse(input, options, 0)
    }

    pub fn parse_raw(
        input: &mut css::Parser,
        tokens: &mut Vec<TokenOrValue>,
        options: &css::ParserOptions,
        depth: usize,
    ) -> Result<()> {
        if depth > 500 {
            return Err(input.new_custom_error(css::ParserError::MaximumNestingDepth));
        }

        loop {
            let state = input.state();
            let Ok(token) = input.next_including_whitespace() else {
                break;
            };
            match token {
                css::Token::OpenParen | css::Token::OpenSquare | css::Token::OpenCurly => {
                    let tok = token.clone();
                    let closing_delimiter = match tok {
                        css::Token::OpenParen => css::Token::CloseParen,
                        css::Token::OpenSquare => css::Token::CloseSquare,
                        css::Token::OpenCurly => css::Token::CloseCurly,
                        _ => unreachable!(),
                    };
                    tokens.push(TokenOrValue::Token(tok));
                    input.parse_nested_block(|input2| {
                        TokenListFns::parse_raw(input2, tokens, options, depth + 1)
                    })?;
                    tokens.push(TokenOrValue::Token(closing_delimiter));
                }
                css::Token::Function(_) => {
                    tokens.push(TokenOrValue::Token(token.clone()));
                    input.parse_nested_block(|input2| {
                        TokenListFns::parse_raw(input2, tokens, options, depth + 1)
                    })?;
                    tokens.push(TokenOrValue::Token(css::Token::CloseParen));
                }
                _ => {
                    if token.is_parse_error() {
                        return Err(css::ParseError {
                            kind: css::ParseErrorKind::Basic(css::BasicParseErrorKind::UnexpectedToken(token.clone())),
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
        input: &mut css::Parser,
        tokens: &mut Vec<TokenOrValue>,
        options: &css::ParserOptions,
        depth: usize,
    ) -> Result<()> {
        if depth > 500 {
            return Err(input.new_custom_error(css::ParserError::MaximumNestingDepth));
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
                css::Token::Whitespace(_) | css::Token::Comment(_) => {
                    // Skip whitespace if the last token was a delimiter.
                    // Otherwise, replace all whitespace and comments with a single space character.
                    if !last_is_delim {
                        tokens.push(TokenOrValue::Token(css::Token::Whitespace(b" ")));
                        last_is_whitespace = true;
                    }
                    continue;
                }
                css::Token::Function(f) => {
                    // Attempt to parse embedded color values into hex tokens.
                    if let Some(color) = try_parse_color_token(f, &state, input) {
                        tokens.push(TokenOrValue::Color(color));
                        last_is_delim = false;
                        last_is_whitespace = false;
                    } else if let Ok(color) = input.try_parse(|i| UnresolvedColor::parse(i, f, options)) {
                        tokens.push(TokenOrValue::UnresolvedColor(color));
                        last_is_delim = false;
                        last_is_whitespace = false;
                    } else if f.as_ref() == b"url" {
                        input.reset(&state);
                        tokens.push(TokenOrValue::Url(Url::parse(input)?));
                        last_is_delim = false;
                        last_is_whitespace = false;
                    } else if f.as_ref() == b"var" {
                        let var = input.parse_nested_block(|input2| {
                            let thevar = Variable::parse(input2, options, depth + 1)?;
                            Ok(TokenOrValue::Var(thevar))
                        })?;
                        tokens.push(var);
                        last_is_delim = true;
                        last_is_whitespace = false;
                    } else if f.as_ref() == b"env" {
                        let env = input.parse_nested_block(|input2| {
                            let env = EnvironmentVariable::parse_nested(input2, options, depth + 1)?;
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
                            name: Ident { v: f.clone() },
                            arguments,
                        }));
                        last_is_delim = true; // Whitespace is not required after any of these chars.
                        last_is_whitespace = false;
                    }
                    continue;
                }
                css::Token::UnrestrictedHash(h) | css::Token::IdHash(h) => {
                    'brk: {
                        let Some((r, g, b, a)) = css::color::parse_hash_color(h) else {
                            tokens.push(TokenOrValue::Token(css::Token::UnrestrictedHash(h.clone())));
                            break 'brk;
                        };
                        tokens.push(TokenOrValue::Color(CssColor::Rgba(RGBA::new(r, g, b, a))));
                    }
                    last_is_delim = false;
                    last_is_whitespace = false;
                    continue;
                }
                css::Token::UnquotedUrl(_) => {
                    input.reset(&state);
                    tokens.push(TokenOrValue::Url(Url::parse(input)?));
                    last_is_delim = false;
                    last_is_whitespace = false;
                    continue;
                }
                css::Token::Ident(name) => {
                    if name.as_ref().starts_with(b"--") {
                        tokens.push(TokenOrValue::DashedIdent(DashedIdent { v: name.clone() }));
                        last_is_delim = false;
                        last_is_whitespace = false;
                        continue;
                    }
                }
                css::Token::OpenParen | css::Token::OpenSquare | css::Token::OpenCurly => {
                    let closing_delimiter = match &tok {
                        css::Token::OpenParen => css::Token::CloseParen,
                        css::Token::OpenSquare => css::Token::CloseSquare,
                        css::Token::OpenCurly => css::Token::CloseCurly,
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
                css::Token::Dimension { .. } => {
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
                return Err(css::ParseError {
                    kind: css::ParseErrorKind::Basic(css::BasicParseErrorKind::UnexpectedToken(tok.clone())),
                    location: state.source_location(),
                });
            }
            last_is_delim = matches!(&tok, css::Token::Delim(_) | css::Token::Comma);

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

    pub fn get_fallback(&self, kind: ColorFallbackKind) -> Self {
        let mut tokens = TokenList::default();
        tokens.v.reserve_exact(self.v.len());
        for old in self.v.iter() {
            let new = match old {
                TokenOrValue::Color(color) => TokenOrValue::Color(color.get_fallback(kind)),
                TokenOrValue::Function(f) => TokenOrValue::Function(f.get_fallback(kind)),
                TokenOrValue::Var(v) => TokenOrValue::Var(v.get_fallback(kind)),
                TokenOrValue::Env(e) => TokenOrValue::Env(e.get_fallback(kind)),
                _ => old.deep_clone(),
            };
            tokens.v.push(new);
        }
        tokens
    }

    pub fn get_fallbacks(&mut self, targets: css::targets::Targets) -> css::SmallList<(SupportsCondition, TokenList), 2> {
        // Get the full list of possible fallbacks, and remove the lowest one, which will replace
        // the original declaration. The remaining fallbacks need to be added as @supports rules.
        let mut fallbacks = self.get_necessary_fallbacks(targets);
        let lowest_fallback = fallbacks.lowest();
        fallbacks.remove(lowest_fallback);

        let mut res = css::SmallList::<(SupportsCondition, TokenList), 2>::new();
        if fallbacks.contains(ColorFallbackKind::P3) {
            // PERF(port): was assume_capacity
            res.push((
                ColorFallbackKind::P3.supports_condition(),
                self.get_fallback(ColorFallbackKind::P3),
            ));
        }

        if fallbacks.contains(ColorFallbackKind::LAB) {
            // PERF(port): was assume_capacity
            res.push((
                ColorFallbackKind::LAB.supports_condition(),
                self.get_fallback(ColorFallbackKind::LAB),
            ));
        }

        if !lowest_fallback.is_empty() {
            for token_or_value in self.v.iter_mut() {
                match token_or_value {
                    TokenOrValue::Color(color) => {
                        *color = color.get_fallback(lowest_fallback);
                    }
                    TokenOrValue::Function(f) => {
                        *f = f.get_fallback(lowest_fallback);
                    }
                    TokenOrValue::Var(v) => {
                        if let Some(fallback) = &mut v.fallback {
                            *fallback = fallback.get_fallback(lowest_fallback);
                        }
                    }
                    TokenOrValue::Env(v) => {
                        if let Some(fallback) = &mut v.fallback {
                            *fallback = fallback.get_fallback(lowest_fallback);
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

    pub fn eql(&self, rhs: &TokenList) -> bool {
        css::generic::eql_list(&self.v, &rhs.v)
    }

    pub fn hash(&self, hasher: &mut Wyhash) {
        css::implement_hash(self, hasher)
    }

    pub fn deep_clone(&self) -> TokenList {
        TokenList {
            v: css::deep_clone(&self.v),
        }
    }
}

pub type TokenListFns = TokenList;

/// A color value with an unresolved alpha value (e.g. a variable).
/// These can be converted from the modern slash syntax to older comma syntax.
/// This can only be done when the only unresolved component is the alpha
/// since variables can resolve to multiple tokens.
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
    pub fn eql(&self, rhs: &Self) -> bool {
        css::implement_eql(self, rhs)
    }

    pub fn hash(&self, hasher: &mut Wyhash) {
        css::implement_hash(self, hasher)
    }

    pub fn deep_clone(&self) -> Self {
        match self {
            UnresolvedColor::RGB { r, g, b, alpha } => UnresolvedColor::RGB {
                r: *r,
                g: *g,
                b: *b,
                alpha: alpha.deep_clone(),
            },
            UnresolvedColor::HSL { h, s, l, alpha } => UnresolvedColor::HSL {
                h: *h,
                s: *s,
                l: *l,
                alpha: alpha.deep_clone(),
            },
            UnresolvedColor::LightDark { light, dark } => UnresolvedColor::LightDark {
                light: light.deep_clone(),
                dark: dark.deep_clone(),
            },
        }
    }

    // deinit(): body only freed owned `TokenList` fields — handled by `Drop`.

    pub fn to_css(
        &self,
        dest: &mut Printer,
        is_custom_property: bool,
    ) -> PrintResult<()> {
        fn conv(c: f32) -> i32 {
            (c * 255.0).round().clamp(0.0, 255.0) as i32
        }

        match self {
            UnresolvedColor::RGB { r, g, b, alpha } => {
                if dest.targets.should_compile_same(css::compat::Feature::SpaceSeparatedColorNotation) {
                    dest.write_str("rgba(")?;
                    css::to_css::integer::<i32>(conv(*r), dest)?;
                    dest.delim(',', false)?;
                    css::to_css::integer::<i32>(conv(*g), dest)?;
                    dest.delim(',', false)?;
                    css::to_css::integer::<i32>(conv(*b), dest)?;
                    alpha.to_css(dest, is_custom_property)?;
                    dest.write_char(')')?;
                    return Ok(());
                }

                dest.write_str("rgb(")?;
                css::to_css::integer::<i32>(conv(*r), dest)?;
                dest.write_char(' ')?;
                css::to_css::integer::<i32>(conv(*g), dest)?;
                dest.write_char(' ')?;
                css::to_css::integer::<i32>(conv(*b), dest)?;
                dest.delim('/', true)?;
                alpha.to_css(dest, is_custom_property)?;
                dest.write_char(')')
            }
            UnresolvedColor::HSL { h, s, l, alpha } => {
                if dest.targets.should_compile_same(css::compat::Feature::SpaceSeparatedColorNotation) {
                    dest.write_str("hsla(")?;
                    CSSNumberFns::to_css(h, dest)?;
                    dest.delim(',', false)?;
                    Percentage { v: *s }.to_css(dest)?;
                    dest.delim(',', false)?;
                    Percentage { v: *l }.to_css(dest)?;
                    dest.delim(',', false)?;
                    alpha.to_css(dest, is_custom_property)?;
                    dest.write_char(')')?;
                    return Ok(());
                }

                dest.write_str("hsl(")?;
                CSSNumberFns::to_css(h, dest)?;
                dest.write_char(' ')?;
                Percentage { v: *s }.to_css(dest)?;
                dest.write_char(' ')?;
                Percentage { v: *l }.to_css(dest)?;
                dest.delim('/', true)?;
                alpha.to_css(dest, is_custom_property)?;
                dest.write_char(')')
            }
            UnresolvedColor::LightDark { light, dark } => {
                if !dest.targets.is_compatible(css::compat::Feature::LightDark) {
                    dest.write_str("var(--buncss-light")?;
                    dest.delim(',', false)?;
                    light.to_css(dest, is_custom_property)?;
                    dest.write_char(')')?;
                    dest.whitespace()?;
                    dest.write_str("var(--buncss-dark")?;
                    dest.delim(',', false)?;
                    dark.to_css(dest, is_custom_property)?;
                    return dest.write_char(')');
                }

                dest.write_str("light-dark(")?;
                light.to_css(dest, is_custom_property)?;
                dest.delim(',', false)?;
                dark.to_css(dest, is_custom_property)?;
                dest.write_char(')')
            }
        }
    }

    pub fn parse(
        input: &mut css::Parser,
        f: &[u8],
        options: &css::ParserOptions,
    ) -> Result<UnresolvedColor> {
        let mut parser = ComponentParser::new(false);
        // css.todo_stuff.match_ignore_ascii_case
        if strings::eql_case_insensitive_ascii_check_length(f, b"rgb") {
            return input.parse_nested_block(|input2| {
                parser.parse_relative::<SRGB, UnresolvedColor, _>(input2, |i, p| {
                    let (r, g, b, is_legacy) = css_values::color::parse_rgb_components(i, p)?;
                    if is_legacy {
                        return Err(i.new_custom_error(css::ParserError::InvalidValue));
                    }
                    i.expect_delim('/')?;
                    let alpha = TokenListFns::parse(i, options, 0)?;
                    Ok(UnresolvedColor::RGB { r, g, b, alpha })
                })
            });
        } else if strings::eql_case_insensitive_ascii_check_length(f, b"hsl") {
            return input.parse_nested_block(|input2| {
                parser.parse_relative::<HSL, UnresolvedColor, _>(input2, |i, p| {
                    let (h, s, l, is_legacy) = css_values::color::parse_hsl_hwb_components::<HSL>(i, p, false)?;
                    if is_legacy {
                        return Err(i.new_custom_error(css::ParserError::InvalidValue));
                    }
                    i.expect_delim('/')?;
                    let alpha = TokenListFns::parse(i, options, 0)?;
                    Ok(UnresolvedColor::HSL { h, s, l, alpha })
                })
            });
        } else if strings::eql_case_insensitive_ascii_check_length(f, b"light-dark") {
            return input.parse_nested_block(|input2| {
                // errdefer doesn't fire on `return .{ .err = ... }` in Zig — but in Rust,
                // `?` drops `light` automatically on the error path.
                let light = input2.parse_until_before(
                    css::Delimiters { comma: true, ..Default::default() },
                    |i| TokenListFns::parse(i, options, 1),
                )?;
                input2.expect_comma()?;
                let dark = TokenListFns::parse(input2, options, 0)?;
                Ok(UnresolvedColor::LightDark { light, dark })
            });
        } else {
            return Err(input.new_custom_error(css::ParserError::InvalidValue));
        }
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

/// A CSS variable reference.
pub struct Variable {
    /// The variable name.
    pub name: DashedIdentReference,
    /// A fallback value in case the variable is not defined.
    pub fallback: Option<TokenList>,
}

impl Variable {
    // deinit(): body only freed owned `TokenList` field — handled by `Drop`.

    pub fn parse(
        input: &mut css::Parser,
        options: &css::ParserOptions,
        depth: usize,
    ) -> Result<Self> {
        let name = DashedIdentReference::parse_with_options(input, options)?;

        let fallback = if input.try_parse(css::Parser::expect_comma).is_ok() {
            Some(TokenList::parse(input, options, depth)?)
        } else {
            None
        };

        Ok(Variable { name, fallback })
    }

    pub fn to_css(
        &self,
        dest: &mut Printer,
        is_custom_property: bool,
    ) -> PrintResult<()> {
        dest.write_str("var(")?;
        self.name.to_css(dest)?;
        if let Some(fallback) = &self.fallback {
            dest.delim(',', false)?;
            fallback.to_css(dest, is_custom_property)?;
        }
        dest.write_char(')')
    }

    pub fn get_fallback(&self, kind: ColorFallbackKind) -> Self {
        Variable {
            name: self.name.clone(),
            fallback: self.fallback.as_ref().map(|fallback| fallback.get_fallback(kind)),
        }
    }

    pub fn eql(&self, rhs: &Self) -> bool {
        css::implement_eql(self, rhs)
    }

    pub fn hash(&self, hasher: &mut Wyhash) {
        css::implement_hash(self, hasher)
    }

    pub fn deep_clone(&self) -> Variable {
        Variable {
            name: self.name.clone(),
            fallback: self.fallback.as_ref().map(|fallback| fallback.deep_clone()),
        }
    }
}

/// A CSS environment variable reference.
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

    pub fn parse(input: &mut css::Parser, options: &css::ParserOptions, depth: usize) -> Result<EnvironmentVariable> {
        input.expect_function_matching("env")?;
        input.parse_nested_block(|i| EnvironmentVariable::parse_nested(i, options, depth))
    }

    pub fn parse_nested(input: &mut css::Parser, options: &css::ParserOptions, depth: usize) -> Result<EnvironmentVariable> {
        let name = EnvironmentVariableName::parse(input)?;
        let mut indices: Vec<i32> = Vec::new();
        while let Ok(idx) = input.try_parse(CSSIntegerFns::parse) {
            indices.push(idx);
        }

        let fallback = if input.try_parse(css::Parser::expect_comma).is_ok() {
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

    pub fn to_css(
        &self,
        dest: &mut Printer,
        is_custom_property: bool,
    ) -> PrintResult<()> {
        dest.write_str("env(")?;
        self.name.to_css(dest)?;

        for index in self.indices.iter() {
            dest.write_char(' ')?;
            css::to_css::integer::<i32>(*index, dest)?;
        }

        if let Some(fallback) = &self.fallback {
            dest.delim(',', false)?;
            fallback.to_css(dest, is_custom_property)?;
        }

        dest.write_char(')')
    }

    pub fn get_fallback(&self, kind: ColorFallbackKind) -> Self {
        EnvironmentVariable {
            name: self.name.clone(),
            indices: self.indices.clone(),
            fallback: self.fallback.as_ref().map(|fallback| fallback.get_fallback(kind)),
        }
    }

    pub fn eql(&self, rhs: &Self) -> bool {
        css::implement_eql(self, rhs)
    }

    pub fn hash(&self, hasher: &mut Wyhash) {
        css::implement_hash(self, hasher)
    }

    pub fn deep_clone(&self) -> EnvironmentVariable {
        EnvironmentVariable {
            name: self.name.clone(),
            indices: self.indices.clone(),
            fallback: self.fallback.as_ref().map(|fallback| fallback.deep_clone()),
        }
    }
}

/// A CSS environment variable name.
#[derive(Clone)]
pub enum EnvironmentVariableName {
    /// A UA-defined environment variable.
    Ua(UAEnvironmentVariable),
    /// A custom author-defined environment variable.
    Custom(DashedIdentReference),
    /// An unknown environment variable.
    Unknown(CustomIdent),
}

impl EnvironmentVariableName {
    pub fn eql(&self, rhs: &Self) -> bool {
        css::implement_eql(self, rhs)
    }

    pub fn hash(&self, hasher: &mut Wyhash) {
        css::implement_hash(self, hasher)
    }

    pub fn parse(input: &mut css::Parser) -> Result<EnvironmentVariableName> {
        if let Ok(ua) = input.try_parse(UAEnvironmentVariable::parse) {
            return Ok(EnvironmentVariableName::Ua(ua));
        }

        if let Ok(dashed) = input.try_parse(|i| {
            DashedIdentReference::parse_with_options(i, &css::ParserOptions::default(None))
        }) {
            return Ok(EnvironmentVariableName::Custom(dashed));
        }

        let ident = CustomIdentFns::parse(input)?;
        Ok(EnvironmentVariableName::Unknown(ident))
    }

    pub fn to_css(&self, dest: &mut Printer) -> PrintResult<()> {
        match self {
            EnvironmentVariableName::Ua(ua) => ua.to_css(dest),
            EnvironmentVariableName::Custom(custom) => custom.to_css(dest),
            EnvironmentVariableName::Unknown(unknown) => CustomIdentFns::to_css(unknown, dest),
        }
    }
}

/// A UA-defined environment variable name.
// TODO(port): css::DefineEnumProperty derive — generates eql/hash/parse/to_css/deep_clone
#[derive(Clone, Copy, PartialEq, Eq, Hash, strum::IntoStaticStr)]
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

css::define_enum_property!(UAEnvironmentVariable);
// TODO(port): the macro above must provide: eql, hash, parse, to_css, deep_clone

/// A custom CSS function.
pub struct Function {
    /// The function name.
    pub name: Ident,
    /// The function arguments.
    pub arguments: TokenList,
}

impl Function {
    // deinit(): body only freed owned `TokenList` field — handled by `Drop`.

    pub fn to_css(
        &self,
        dest: &mut Printer,
        is_custom_property: bool,
    ) -> PrintResult<()> {
        IdentFns::to_css(&self.name, dest)?;
        dest.write_char('(')?;
        self.arguments.to_css(dest, is_custom_property)?;
        dest.write_char(')')
    }

    pub fn eql(&self, rhs: &Self) -> bool {
        css::implement_eql(self, rhs)
    }

    pub fn hash(&self, hasher: &mut Wyhash) {
        css::implement_hash(self, hasher)
    }

    pub fn deep_clone(&self) -> Function {
        Function {
            name: self.name.clone(),
            arguments: self.arguments.deep_clone(),
        }
    }

    pub fn get_fallback(&self, kind: ColorFallbackKind) -> Self {
        Function {
            name: self.name.deep_clone(),
            arguments: self.arguments.get_fallback(kind),
        }
    }
}

/// A raw CSS token, or a parsed value.
pub enum TokenOrValue {
    /// A token.
    Token(css::Token),
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
    pub fn eql(&self, rhs: &TokenOrValue) -> bool {
        css::implement_eql(self, rhs)
    }

    pub fn hash(&self, hasher: &mut Wyhash) {
        css::implement_hash(self, hasher)
    }

    pub fn deep_clone(&self) -> TokenOrValue {
        match self {
            TokenOrValue::Token(t) => TokenOrValue::Token(t.clone()),
            TokenOrValue::Color(color) => TokenOrValue::Color(color.deep_clone()),
            TokenOrValue::UnresolvedColor(color) => TokenOrValue::UnresolvedColor(color.deep_clone()),
            TokenOrValue::Url(u) => TokenOrValue::Url(u.clone()),
            TokenOrValue::Var(var) => TokenOrValue::Var(var.deep_clone()),
            TokenOrValue::Env(env) => TokenOrValue::Env(env.deep_clone()),
            TokenOrValue::Function(f) => TokenOrValue::Function(f.deep_clone()),
            TokenOrValue::Length(v) => TokenOrValue::Length(*v),
            TokenOrValue::Angle(v) => TokenOrValue::Angle(*v),
            TokenOrValue::Time(v) => TokenOrValue::Time(*v),
            TokenOrValue::Resolution(v) => TokenOrValue::Resolution(*v),
            TokenOrValue::DashedIdent(v) => TokenOrValue::DashedIdent(v.clone()),
            TokenOrValue::AnimationName(v) => TokenOrValue::AnimationName(v.clone()),
        }
    }

    // deinit(): all arms only freed owned fields — handled by `Drop`.

    pub fn is_whitespace(&self) -> bool {
        matches!(self, TokenOrValue::Token(css::Token::Whitespace(_)))
    }
}

/// A known property with an unparsed value.
///
/// This type is used when the value of a known property could not
/// be parsed, e.g. in the case css `var()` references are encountered.
/// In this case, the raw tokens are stored instead.
pub struct UnparsedProperty {
    /// The id of the property.
    pub property_id: css::PropertyId,
    /// The property value, stored as a raw token list.
    pub value: TokenList,
}

impl UnparsedProperty {
    pub fn parse(property_id: css::PropertyId, input: &mut css::Parser, options: &css::ParserOptions) -> Result<UnparsedProperty> {
        let value = input.parse_until_before(
            css::Delimiters { bang: true, semicolon: true, ..Default::default() },
            |i| TokenList::parse(i, options, 0),
        )?;

        Ok(UnparsedProperty { property_id, value })
    }

    pub fn get_prefixed(&self, targets: css::Targets, feature: css::prefixes::Feature) -> UnparsedProperty {
        let mut clone = self.deep_clone();
        let prefix = self.property_id.prefix();
        clone.property_id = clone.property_id.with_prefix(targets.prefixes(prefix.or_none(), feature));
        clone
    }

    /// Returns a new UnparsedProperty with the same value and the given property id.
    pub fn with_property_id(&self, property_id: css::PropertyId) -> UnparsedProperty {
        UnparsedProperty {
            property_id,
            value: self.value.deep_clone(),
        }
    }

    pub fn deep_clone(&self) -> Self {
        css::implement_deep_clone(self)
    }

    pub fn eql(&self, rhs: &Self) -> bool {
        css::implement_eql(self, rhs)
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
    pub fn parse(name: CustomPropertyName, input: &mut css::Parser, options: &css::ParserOptions) -> Result<CustomProperty> {
        let value = input.parse_until_before(
            css::Delimiters { bang: true, semicolon: true, ..Default::default() },
            |input2| TokenListFns::parse(input2, options, 0),
        )?;

        Ok(CustomProperty { name, value })
    }

    pub fn deep_clone(&self) -> Self {
        css::implement_deep_clone(self)
    }

    pub fn eql(&self, rhs: &Self) -> bool {
        css::implement_eql(self, rhs)
    }
}

/// A CSS custom property name.
pub enum CustomPropertyName {
    /// An author-defined CSS custom property.
    Custom(DashedIdent),
    /// An unknown CSS property.
    Unknown(Ident),
}

impl CustomPropertyName {
    pub fn to_css(&self, dest: &mut Printer) -> PrintResult<()> {
        match self {
            CustomPropertyName::Custom(custom) => custom.to_css(dest),
            CustomPropertyName::Unknown(unknown) => {
                css::serializer::serialize_identifier(&unknown.v, dest).map_err(|_| dest.add_fmt_error_value())
                // TODO(port): Zig `catch return dest.addFmtError()` — exact error mapping needs Phase B
            }
        }
    }

    pub fn from_str(name: &[u8]) -> CustomPropertyName {
        if name.starts_with(b"--") {
            return CustomPropertyName::Custom(DashedIdent { v: name.into() });
        }
        CustomPropertyName::Unknown(Ident { v: name.into() })
    }

    pub fn as_str(&self) -> &[u8] {
        match self {
            CustomPropertyName::Custom(custom) => custom.v.as_ref(),
            CustomPropertyName::Unknown(unknown) => unknown.v.as_ref(),
        }
    }

    pub fn deep_clone(&self) -> Self {
        css::implement_deep_clone(self)
    }

    pub fn eql(&self, rhs: &Self) -> bool {
        css::implement_eql(self, rhs)
    }
}

pub fn try_parse_color_token(f: &[u8], state: &css::ParserState, input: &mut css::Parser) -> Option<CssColor> {
    // css.todo_stuff.match_ignore_ascii_case
    if strings::eql_case_insensitive_ascii_check_length(f, b"rgb")
        || strings::eql_case_insensitive_ascii_check_length(f, b"rgba")
        || strings::eql_case_insensitive_ascii_check_length(f, b"hsl")
        || strings::eql_case_insensitive_ascii_check_length(f, b"hsla")
        || strings::eql_case_insensitive_ascii_check_length(f, b"hwb")
        || strings::eql_case_insensitive_ascii_check_length(f, b"lab")
        || strings::eql_case_insensitive_ascii_check_length(f, b"lch")
        || strings::eql_case_insensitive_ascii_check_length(f, b"oklab")
        || strings::eql_case_insensitive_ascii_check_length(f, b"oklch")
        || strings::eql_case_insensitive_ascii_check_length(f, b"color")
        || strings::eql_case_insensitive_ascii_check_length(f, b"color-mix")
        || strings::eql_case_insensitive_ascii_check_length(f, b"light-dark")
    {
        let s = input.state();
        input.reset(state);
        if let Ok(color) = CssColor::parse(input) {
            return Some(color);
        }
        input.reset(&s);
    }

    None
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/properties/custom.zig (1554 lines)
//   confidence: medium
//   todos:      4
//   notes:      Allocator params dropped (Vec/global mimalloc per LIFETIMES.tsv); Zig closure structs collapsed to Rust closures; css::Token variant shapes, ParserOptions::default arity, define_enum_property! macro, and implement_eql/hash/deep_clone helpers need Phase B wiring.
// ──────────────────────────────────────────────────────────────────────────
